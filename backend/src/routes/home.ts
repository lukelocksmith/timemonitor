import { Router, Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { db } from '../database.js';
import { AuthenticatedRequest } from '../types/auth.js';
import { getScope, requireWorkerLink } from '../auth/scope.js';
import { DURATION_FILTER_SQL } from '../constants.js';

export const homeRouter = Router();

homeRouter.use(requireAuth);

const DEDUPED_WORKERS = `
  (SELECT
     clickup_user_id,
     MAX(hourly_rate) as hourly_rate,
     MAX(name) as name
   FROM notion_workers
   WHERE clickup_user_id IS NOT NULL
   GROUP BY clickup_user_id)`;

function getDateRange(period: string): { start: string; end: string; period: string } {
  const now = new Date();
  let start: Date;
  let end: Date;

  switch (period) {
    case 'today': {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      break;
    }
    case 'yesterday': {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    }
    case 'week': {
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
      end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
      break;
    }
    case 'last_month': {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    }
    case 'month':
    default: {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      break;
    }
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    period,
  };
}

function resolveRange(req: AuthenticatedRequest): { start: string; end: string; period: string } {
  const startParam = req.query.start as string | undefined;
  const endParam = req.query.end as string | undefined;

  if (startParam || endParam) {
    if (!startParam || !endParam) {
      throw new Error('Parametry start i end muszą być podane razem');
    }

    const startDate = new Date(startParam);
    const endDate = new Date(endParam);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Nieprawidłowy format daty');
    }

    if (startDate > endDate) {
      throw new Error('Data start nie może być po end');
    }

    return {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      period: 'custom',
    };
  }

  const period = (req.query.period as string) || 'today';
  return getDateRange(period);
}

homeRouter.get('/summary', (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = getScope(req);
    const { start, end, period } = resolveRange(req);
    const isAdmin = scope.isAdmin || scope.isPm;
    const userFilter = isAdmin ? null : requireWorkerLink(scope.appUser);
    if (!isAdmin && !userFilter) {
      return res.status(403).json({ error: 'Brak powiązania z pracownikiem (ClickUp)' });
    }

    const userClause = userFilter ? 'AND te.user_id = ?' : '';
    const baseParams: (string | number)[] = userFilter ? [start, end, userFilter] : [start, end];

    // Totals
    const totalsRow = db
      .prepare(
        `SELECT
          COALESCE(SUM(te.duration), 0) as total_duration,
          ROUND(COALESCE(SUM(te.duration) / 3600000.0, 0), 2) as total_hours,
          COUNT(DISTINCT te.task_id) as tasks_count,
          COUNT(te.id) as entries_count
         FROM time_entries te
         WHERE te.end_time IS NOT NULL
           AND te.start_time >= ? AND te.start_time < ?
           ${DURATION_FILTER_SQL}
           ${userClause}`
      )
      .get(...baseParams) as {
      total_duration: number;
      total_hours: number;
      tasks_count: number;
      entries_count: number;
    };

    // Earnings: for admin = sum of hours * worker_rate (cost), for user = hours * own_rate
    let totalEarnings = 0;
    let hourlyRate: number | null = null;

    if (isAdmin) {
      // Admin: total cost = sum(hours * worker_rate) for all workers
      const earningsRow = db
        .prepare(
          `SELECT
            ROUND(COALESCE(SUM((te.duration / 3600000.0) * nw.hourly_rate), 0), 2) as total_cost
           FROM time_entries te
           JOIN ${DEDUPED_WORKERS} nw ON nw.clickup_user_id = te.user_id
           WHERE te.end_time IS NOT NULL
             AND te.start_time >= ? AND te.start_time < ?
             ${DURATION_FILTER_SQL}`
        )
        .get(start, end) as { total_cost: number } | undefined;
      totalEarnings = earningsRow?.total_cost ?? 0;
    } else if (userFilter) {
      // User: own rate * hours
      const workerRow = db
        .prepare(
          `SELECT hourly_rate FROM ${DEDUPED_WORKERS} WHERE clickup_user_id = ?`
        )
        .get(userFilter) as { hourly_rate: number } | undefined;
      hourlyRate = workerRow?.hourly_rate ?? null;
      if (hourlyRate) {
        totalEarnings = Math.round(totalsRow.total_hours * hourlyRate * 100) / 100;
      }
    }

    // Tasks grouped
    const tasks = db
      .prepare(
        `SELECT
          te.task_id,
          te.task_name,
          MAX(te.task_url) as task_url,
          MAX(te.list_name) as list_name,
          COALESCE(SUM(te.duration), 0) as total_duration,
          ROUND(COALESCE(SUM(te.duration) / 3600000.0, 0), 2) as hours_worked,
          COUNT(te.id) as entries_count,
          MIN(te.start_time) as first_start_time
         FROM time_entries te
         WHERE te.end_time IS NOT NULL
           AND te.start_time >= ? AND te.start_time < ?
           ${DURATION_FILTER_SQL}
           ${userClause}
         GROUP BY te.task_id
         ORDER BY total_duration DESC`
      )
      .all(...baseParams) as Array<{
      task_id: string;
      task_name: string;
      task_url: string | null;
      list_name: string | null;
      total_duration: number;
      hours_worked: number;
      entries_count: number;
      first_start_time: string | null;
    }>;

    // Users per task (for avatars)
    const taskUsers = db
      .prepare(
        `SELECT
          te.task_id,
          te.user_id,
          te.user_name,
          u.color as user_color,
          u.profile_picture as user_avatar
         FROM time_entries te
         LEFT JOIN users u ON te.user_id = u.id
         WHERE te.end_time IS NOT NULL
           AND te.start_time >= ? AND te.start_time < ?
           ${DURATION_FILTER_SQL}
           ${userClause}
         GROUP BY te.task_id, te.user_id
         ORDER BY te.task_id, MIN(te.start_time) ASC`
      )
      .all(...baseParams) as Array<{
      task_id: string;
      user_id: string;
      user_name: string;
      user_color: string | null;
      user_avatar: string | null;
    }>;

    // Group users by task_id
    const usersByTask = new Map<string, Array<{ user_id: string; user_name: string; user_color: string | null; user_avatar: string | null }>>();
    for (const row of taskUsers) {
      const list = usersByTask.get(row.task_id) || [];
      list.push({ user_id: row.user_id, user_name: row.user_name, user_color: row.user_color, user_avatar: row.user_avatar });
      usersByTask.set(row.task_id, list);
    }

    // Ensure task_url fallback + attach users
    const tasksWithUrls = tasks.map((t) => ({
      ...t,
      task_url: t.task_url || (t.task_id ? `https://app.clickup.com/t/${t.task_id}` : null),
      users: usersByTask.get(t.task_id) || [],
    }));

    res.json({
      period,
      start,
      end,
      totals: {
        total_hours: totalsRow.total_hours,
        total_duration: totalsRow.total_duration,
        total_earnings: totalEarnings,
        hourly_rate: hourlyRate,
        tasks_count: totalsRow.tasks_count,
        entries_count: totalsRow.entries_count,
      },
      tasks: tasksWithUrls,
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

// GET /api/home/task-entries — szczegółowe wpisy dla konkretnego taska
homeRouter.get('/task-entries', (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = getScope(req);
    const taskId = req.query.task_id as string;
    if (!taskId) {
      return res.status(400).json({ error: 'Wymagany parametr task_id' });
    }

    const { start, end } = resolveRange(req);
    const isAdmin = scope.isAdmin || scope.isPm;
    const userFilter = isAdmin ? null : requireWorkerLink(scope.appUser);
    if (!isAdmin && !userFilter) {
      return res.status(403).json({ error: 'Brak powiązania z pracownikiem (ClickUp)' });
    }

    const userClause = userFilter ? 'AND te.user_id = ?' : '';
    const params: (string | number)[] = userFilter
      ? [taskId, start, end, userFilter]
      : [taskId, start, end];

    const entries = db
      .prepare(
        `SELECT
          te.id,
          te.start_time,
          te.end_time,
          te.duration,
          te.description,
          te.user_id,
          te.user_name,
          u.color as user_color,
          u.profile_picture as user_avatar
         FROM time_entries te
         LEFT JOIN users u ON te.user_id = u.id
         WHERE te.task_id = ?
           AND te.end_time IS NOT NULL
           AND te.start_time >= ? AND te.start_time < ?
           ${DURATION_FILTER_SQL}
           ${userClause}
         ORDER BY te.start_time ASC`
      )
      .all(...params) as Array<{
      id: string;
      start_time: string;
      end_time: string;
      duration: number;
      description: string | null;
      user_id: string;
      user_name: string;
      user_color: string | null;
      user_avatar: string | null;
    }>;

    res.json({ task_id: taskId, entries });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});
