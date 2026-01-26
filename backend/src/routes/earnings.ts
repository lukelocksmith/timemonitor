import { Router, Response } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { db, upsertTask, upsertUser } from '../database.js';
import { AuthenticatedRequest } from '../types/auth.js';
import { fetchClickUpTask, fetchClickUpTeamMembers, fetchClickUpTimeEntries, getClickUpTeamId } from '../clickup.js';
import { getScope, requireWorkerLink } from '../auth/scope.js';
import { MAX_ENTRY_DURATION_MS, DURATION_FILTER_SQL, MAX_IMPORT_ENTRIES_PER_USER } from '../constants.js';

export const earningsRouter = Router();

// Wszystkie endpointy zarobków wymagają autoryzacji
earningsRouter.use(requireAuth);

const DEDUPED_PROJECTS = `
  (SELECT
     clickup_id,
     MAX(hourly_rate) as hourly_rate,
     MAX(monthly_budget) as monthly_budget,
     MAX(is_internal) as is_internal,
     MAX(name) as name
   FROM notion_projects
   WHERE clickup_id IS NOT NULL
   GROUP BY clickup_id)`;

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
  let end: Date = now;

  switch (period) {
    case 'today': {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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
      break;
    }
    case 'last_month': {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      break;
    }
    case 'month':
    default: {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
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

  const period = (req.query.period as string) || 'month';
  return getDateRange(period);
}

function resolveImportRange(req: AuthenticatedRequest): { start: Date; end: Date; label: string } {
  const startParam = req.query.start as string | undefined;
  const endParam = req.query.end as string | undefined;
  const fromYearParam = req.query.from_year as string | undefined;
  const toYearParam = req.query.to_year as string | undefined;
  const yearParam = req.query.year as string | undefined;

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
    return { start: startDate, end: endDate, label: 'custom' };
  }

  if (yearParam) {
    const year = parseInt(yearParam, 10);
    if (isNaN(year)) {
      throw new Error('Nieprawidłowy year');
    }
    return {
      start: new Date(year, 0, 1),
      end: new Date(year, 11, 31, 23, 59, 59),
      label: String(year),
    };
  }

  if (fromYearParam || toYearParam) {
    if (!fromYearParam || !toYearParam) {
      throw new Error('Parametry from_year i to_year muszą być podane razem');
    }
    const fromYear = parseInt(fromYearParam, 10);
    const toYear = parseInt(toYearParam, 10);
    if (isNaN(fromYear) || isNaN(toYear)) {
      throw new Error('Nieprawidłowe from_year/to_year');
    }
    if (fromYear > toYear) {
      throw new Error('from_year nie może być większy niż to_year');
    }
    return {
      start: new Date(fromYear, 0, 1),
      end: new Date(toYear, 11, 31, 23, 59, 59),
      label: `${fromYear}-${toYear}`,
    };
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  return {
    start: new Date(currentYear - 1, 0, 1),
    end: new Date(currentYear, 11, 31, 23, 59, 59),
    label: `${currentYear - 1}-${currentYear}`,
  };
}

// CTE: oblicza przychód dla projektów z budżetem miesięcznym (np. EFF/SEO 2500 PLN/mies.)
// budget_revenue = monthly_budget × liczba unikalnych miesięcy z wpisami w zakresie dat
// budget_total_hours = łączne godziny projektu - do proporcjonalnego rozdziału przychodu
function buildProjectBudgetCTE(userClause: string = ''): string {
  return `project_budget AS (
    SELECT np.clickup_id,
      np.monthly_budget * COUNT(DISTINCT strftime('%Y-%m', te.start_time)) as budget_revenue,
      NULLIF(SUM(te.duration / 3600000.0), 0) as budget_total_hours
    FROM time_entries te
    JOIN tasks t ON t.id = te.task_id
    JOIN ${DEDUPED_PROJECTS} np ON np.clickup_id = t.list_id AND np.monthly_budget > 0
    JOIN ${DEDUPED_WORKERS} nw ON nw.clickup_user_id = te.user_id
    WHERE te.end_time IS NOT NULL
      AND te.start_time >= ? AND te.start_time <= ?
      ${userClause}
    GROUP BY np.clickup_id
  )`;
}

// Wyrażenie SQL na przychód per wpis: budżetowy (proporcjonalnie) lub godzinowy.
// Projekty wewnętrzne (is_internal=1) mają przychód 0 — generują tylko koszty.
const ENTRY_REVENUE = `
  CASE
    WHEN np.is_internal = 1 THEN 0
    WHEN pb.clickup_id IS NOT NULL AND pb.budget_total_hours > 0
    THEN (te.duration / 3600000.0) / pb.budget_total_hours * pb.budget_revenue
    ELSE (te.duration / 3600000.0) * np.hourly_rate
  END`;

earningsRouter.get('/summary', (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = getScope(req);
    const { start, end, period } = resolveRange(req);
    const isAdmin = scope.isAdmin;
    const userFilter = isAdmin ? null : requireWorkerLink(scope.appUser);
    if (!isAdmin && !userFilter) {
      return res.status(403).json({ error: 'Brak powiązania z pracownikiem (ClickUp)' });
    }

    const userClause = userFilter ? 'AND te.user_id = ?' : '';
    const cte = buildProjectBudgetCTE(userClause);
    const baseParams = userFilter ? [start, end, userFilter] : [start, end];
    // CTE params + main query params
    const params = [...baseParams, ...baseParams];

    const mappedTotals = isAdmin
      ? (db
          .prepare(
            `WITH ${cte}
             SELECT
              COALESCE(SUM(te.duration), 0) as total_duration,
              ROUND(COALESCE(SUM(${ENTRY_REVENUE}), 0), 2) as total_revenue,
              ROUND(COALESCE(SUM((te.duration / 3600000.0) * nw.hourly_rate), 0), 2) as total_cost,
              ROUND(COALESCE(SUM(${ENTRY_REVENUE}) - SUM((te.duration / 3600000.0) * nw.hourly_rate), 0), 2) as total_profit,
              ROUND(COALESCE(SUM(te.duration) / 3600000.0, 0), 2) as total_hours
             FROM time_entries te
             JOIN tasks t ON t.id = te.task_id
             JOIN ${DEDUPED_PROJECTS} np ON np.clickup_id = t.list_id
             JOIN ${DEDUPED_WORKERS} nw ON nw.clickup_user_id = te.user_id
             LEFT JOIN project_budget pb ON pb.clickup_id = np.clickup_id
             WHERE te.end_time IS NOT NULL
               AND te.start_time >= ? AND te.start_time <= ?
               ${DURATION_FILTER_SQL}`
          )
          .get(...params) as {
          total_duration: number;
          total_revenue: number;
          total_cost: number;
          total_profit: number;
          total_hours: number;
        })
      : (db
          .prepare(
            `WITH ${cte}
             SELECT
              COALESCE(SUM(te.duration), 0) as total_duration,
              ROUND(COALESCE(SUM(${ENTRY_REVENUE}) - SUM((te.duration / 3600000.0) * nw.hourly_rate), 0), 2) as total_profit,
              ROUND(COALESCE(SUM(te.duration) / 3600000.0, 0), 2) as total_hours
             FROM time_entries te
             JOIN tasks t ON t.id = te.task_id
             JOIN ${DEDUPED_PROJECTS} np ON np.clickup_id = t.list_id
             JOIN ${DEDUPED_WORKERS} nw ON nw.clickup_user_id = te.user_id
             LEFT JOIN project_budget pb ON pb.clickup_id = np.clickup_id
             WHERE te.end_time IS NOT NULL
               AND te.start_time >= ? AND te.start_time <= ?
               ${DURATION_FILTER_SQL}
               ${userClause}`
          )
          .get(...params) as {
          total_duration: number;
          total_profit: number;
          total_hours: number;
        });

    const totalEntries = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM time_entries te
         WHERE te.end_time IS NOT NULL
           AND te.start_time >= ? AND te.start_time <= ?
           ${DURATION_FILTER_SQL}
           ${userClause}`
      )
      .get(...baseParams) as { count: number };

    const mappedEntries = db
      .prepare(
        `SELECT COUNT(DISTINCT te.id) as count
         FROM time_entries te
         JOIN tasks t ON t.id = te.task_id
         JOIN ${DEDUPED_PROJECTS} np ON np.clickup_id = t.list_id
         JOIN ${DEDUPED_WORKERS} nw ON nw.clickup_user_id = te.user_id
         WHERE te.end_time IS NOT NULL
           AND te.start_time >= ? AND te.start_time <= ?
           ${DURATION_FILTER_SQL}
           ${userClause}`
      )
      .get(...baseParams) as { count: number };

    res.json({
      period,
      start,
      end,
      totals: mappedTotals,
      entries: {
        total: totalEntries.count,
        mapped: mappedEntries.count,
        unmapped: totalEntries.count - mappedEntries.count,
      },
    });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

earningsRouter.get('/by-user', (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = getScope(req);
    const { start, end, period } = resolveRange(req);
    const isAdmin = scope.isAdmin;
    const userFilter = isAdmin ? null : requireWorkerLink(scope.appUser);

    const userClause = userFilter ? 'AND te.user_id = ?' : '';
    const cte = buildProjectBudgetCTE(userClause);
    const baseParams = userFilter ? [start, end, userFilter] : [start, end];
    const params = [...baseParams, ...baseParams];

    const rows = isAdmin
      ? db
          .prepare(
            `WITH ${cte}
             SELECT
              nw.clickup_user_id as user_id,
              nw.name as user_name,
              nw.hourly_rate as worker_rate,
              ROUND(SUM(te.duration) / 3600000.0, 2) as hours_worked,
              ROUND(SUM(${ENTRY_REVENUE}), 2) as revenue,
              ROUND(SUM((te.duration / 3600000.0) * nw.hourly_rate), 2) as cost,
              ROUND(SUM(${ENTRY_REVENUE}) - SUM((te.duration / 3600000.0) * nw.hourly_rate), 2) as profit,
              COUNT(DISTINCT te.task_id) as tasks_count,
              COUNT(te.id) as entries_count
             FROM time_entries te
             JOIN tasks t ON t.id = te.task_id
             JOIN ${DEDUPED_PROJECTS} np ON np.clickup_id = t.list_id
             JOIN ${DEDUPED_WORKERS} nw ON nw.clickup_user_id = te.user_id
             LEFT JOIN project_budget pb ON pb.clickup_id = np.clickup_id
             WHERE te.end_time IS NOT NULL
               AND te.start_time >= ? AND te.start_time <= ?
               ${DURATION_FILTER_SQL}
             GROUP BY nw.clickup_user_id
             ORDER BY revenue DESC`
          )
          .all(...params)
      : db
          .prepare(
            `WITH ${cte}
             SELECT
              nw.clickup_user_id as user_id,
              nw.name as user_name,
              nw.hourly_rate as worker_rate,
              ROUND(SUM(te.duration) / 3600000.0, 2) as hours_worked,
              ROUND(SUM(${ENTRY_REVENUE}) - SUM((te.duration / 3600000.0) * nw.hourly_rate), 2) as profit,
              COUNT(te.id) as entries_count
             FROM time_entries te
             JOIN tasks t ON t.id = te.task_id
             JOIN ${DEDUPED_PROJECTS} np ON np.clickup_id = t.list_id
             JOIN ${DEDUPED_WORKERS} nw ON nw.clickup_user_id = te.user_id
             LEFT JOIN project_budget pb ON pb.clickup_id = np.clickup_id
             WHERE te.end_time IS NOT NULL
               AND te.start_time >= ? AND te.start_time <= ?
               ${DURATION_FILTER_SQL}
               AND te.user_id = ?
             GROUP BY nw.clickup_user_id
             ORDER BY profit DESC`
          )
          .all(...params);

    res.json({ period, start, end, users: rows });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

earningsRouter.get('/by-project', (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = getScope(req);
    const { start, end, period } = resolveRange(req);
    const isAdmin = scope.isAdmin;
    const userFilter = isAdmin ? null : requireWorkerLink(scope.appUser);

    const userClause = userFilter ? 'AND te.user_id = ?' : '';
    const cte = buildProjectBudgetCTE(userClause);
    const baseParams = userFilter ? [start, end, userFilter] : [start, end];
    const params = [...baseParams, ...baseParams];

    const rows = isAdmin
      ? db
          .prepare(
            `WITH ${cte}
             SELECT
              np.clickup_id as project_clickup_id,
              np.name as project_name,
              np.hourly_rate as project_rate,
              np.monthly_budget as monthly_budget,
              ROUND(SUM(te.duration) / 3600000.0, 2) as hours_worked,
              ROUND(SUM(${ENTRY_REVENUE}), 2) as revenue,
              ROUND(SUM((te.duration / 3600000.0) * nw.hourly_rate), 2) as cost,
              ROUND(SUM(${ENTRY_REVENUE}) - SUM((te.duration / 3600000.0) * nw.hourly_rate), 2) as profit,
              COUNT(DISTINCT nw.clickup_user_id) as workers_count,
              COUNT(DISTINCT te.task_id) as tasks_count,
              COUNT(te.id) as entries_count
             FROM time_entries te
             JOIN tasks t ON t.id = te.task_id
             JOIN ${DEDUPED_PROJECTS} np ON np.clickup_id = t.list_id
             JOIN ${DEDUPED_WORKERS} nw ON nw.clickup_user_id = te.user_id
             LEFT JOIN project_budget pb ON pb.clickup_id = np.clickup_id
             WHERE te.end_time IS NOT NULL
               AND te.start_time >= ? AND te.start_time <= ?
               ${DURATION_FILTER_SQL}
             GROUP BY np.clickup_id
             ORDER BY revenue DESC`
          )
          .all(...params)
      : db
          .prepare(
            `WITH ${cte}
             SELECT
              np.clickup_id as project_clickup_id,
              np.name as project_name,
              ROUND(SUM(te.duration) / 3600000.0, 2) as hours_worked,
              ROUND(SUM(${ENTRY_REVENUE}) - SUM((te.duration / 3600000.0) * nw.hourly_rate), 2) as profit,
              COUNT(DISTINCT nw.clickup_user_id) as workers_count,
              COUNT(te.id) as entries_count
             FROM time_entries te
             JOIN tasks t ON t.id = te.task_id
             JOIN ${DEDUPED_PROJECTS} np ON np.clickup_id = t.list_id
             JOIN ${DEDUPED_WORKERS} nw ON nw.clickup_user_id = te.user_id
             LEFT JOIN project_budget pb ON pb.clickup_id = np.clickup_id
             WHERE te.end_time IS NOT NULL
               AND te.start_time >= ? AND te.start_time <= ?
               ${DURATION_FILTER_SQL}
               AND te.user_id = ?
             GROUP BY np.clickup_id
             ORDER BY profit DESC`
          )
          .all(...params);

    res.json({ period, start, end, projects: rows });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

earningsRouter.get('/details', (req: AuthenticatedRequest, res: Response) => {
  try {
    const scope = getScope(req);
    const { start, end, period } = resolveRange(req);
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);
    const offset = parseInt(req.query.offset as string) || 0;
    const isAdmin = scope.isAdmin;
    const userFilter = isAdmin ? null : requireWorkerLink(scope.appUser);
    if (!isAdmin && !userFilter) {
      return res.status(403).json({ error: 'Brak powiązania z pracownikiem (ClickUp)' });
    }

    const userClause = userFilter ? 'AND te.user_id = ?' : '';
    const cte = buildProjectBudgetCTE(userClause);
    const baseParams = userFilter ? [start, end, userFilter] : [start, end];

    const rows = isAdmin
      ? db
          .prepare(
            `WITH ${cte}
             SELECT
              te.id,
              te.task_id,
              te.task_name,
              te.start_time,
              te.end_time,
              te.duration,
              nw.clickup_user_id as user_id,
              nw.name as user_name,
              nw.hourly_rate as worker_rate,
              np.clickup_id as project_clickup_id,
              np.name as project_name,
              np.hourly_rate as project_rate,
              np.monthly_budget as monthly_budget,
              t.list_id as clickup_list_id,
              ROUND(te.duration / 3600000.0, 2) as hours_worked,
              ROUND(${ENTRY_REVENUE}, 2) as revenue,
              ROUND((te.duration / 3600000.0) * nw.hourly_rate, 2) as cost,
              ROUND((${ENTRY_REVENUE}) - (te.duration / 3600000.0) * nw.hourly_rate, 2) as profit
             FROM time_entries te
             JOIN tasks t ON t.id = te.task_id
             JOIN ${DEDUPED_PROJECTS} np ON np.clickup_id = t.list_id
             JOIN ${DEDUPED_WORKERS} nw ON nw.clickup_user_id = te.user_id
             LEFT JOIN project_budget pb ON pb.clickup_id = np.clickup_id
             WHERE te.end_time IS NOT NULL
               AND te.start_time >= ? AND te.start_time <= ?
               ${DURATION_FILTER_SQL}
             ORDER BY te.end_time DESC
             LIMIT ? OFFSET ?`
          )
          .all(...baseParams, ...baseParams, limit, offset)
      : db
          .prepare(
            `WITH ${cte}
             SELECT
              te.id,
              te.task_id,
              te.task_name,
              te.start_time,
              te.end_time,
              te.duration,
              nw.clickup_user_id as user_id,
              nw.name as user_name,
              np.clickup_id as project_clickup_id,
              np.name as project_name,
              t.list_id as clickup_list_id,
              ROUND(te.duration / 3600000.0, 2) as hours_worked,
              ROUND((${ENTRY_REVENUE}) - (te.duration / 3600000.0) * nw.hourly_rate, 2) as profit
             FROM time_entries te
             JOIN tasks t ON t.id = te.task_id
             JOIN ${DEDUPED_PROJECTS} np ON np.clickup_id = t.list_id
             JOIN ${DEDUPED_WORKERS} nw ON nw.clickup_user_id = te.user_id
             LEFT JOIN project_budget pb ON pb.clickup_id = np.clickup_id
             WHERE te.end_time IS NOT NULL
               AND te.start_time >= ? AND te.start_time <= ?
               ${DURATION_FILTER_SQL}
               AND te.user_id = ?
             ORDER BY te.end_time DESC
             LIMIT ? OFFSET ?`
          )
          .all(...baseParams, ...baseParams, limit, offset);

    const total = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM time_entries te
         JOIN tasks t ON t.id = te.task_id
         JOIN ${DEDUPED_PROJECTS} np ON np.clickup_id = t.list_id
         JOIN ${DEDUPED_WORKERS} nw ON nw.clickup_user_id = te.user_id
         WHERE te.end_time IS NOT NULL
           AND te.start_time >= ? AND te.start_time <= ?
           ${DURATION_FILTER_SQL}
           ${userClause}`
      )
      .get(...baseParams) as { count: number };

    res.json({ period, start, end, limit, offset, total: total.count, entries: rows });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

earningsRouter.get('/unmapped', requireRole('admin'), (req: AuthenticatedRequest, res: Response) => {
  try {
    const { start, end, period } = resolveRange(req);
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);
    const offset = parseInt(req.query.offset as string) || 0;

    const rows = db
      .prepare(
        `SELECT
          te.id,
          te.task_id,
          te.task_name,
          te.user_id,
          te.user_name,
          te.start_time,
          te.end_time,
          t.list_id,
          t.list_name,
          t.space_name,
          t.folder_name,
          CASE
            WHEN t.id IS NULL THEN 'missing_task'
            WHEN t.list_id IS NULL THEN 'missing_list_id'
            WHEN np.clickup_id IS NULL THEN 'missing_project'
            WHEN nw.clickup_user_id IS NULL THEN 'missing_worker'
            ELSE 'unknown'
          END as reason
         FROM time_entries te
         LEFT JOIN tasks t ON t.id = te.task_id
         LEFT JOIN ${DEDUPED_PROJECTS} np ON np.clickup_id = t.list_id
         LEFT JOIN ${DEDUPED_WORKERS} nw ON nw.clickup_user_id = te.user_id
         WHERE te.end_time IS NOT NULL
           AND te.start_time >= ? AND te.start_time <= ?
           ${DURATION_FILTER_SQL}
           AND (
             t.id IS NULL OR t.list_id IS NULL OR np.clickup_id IS NULL OR nw.clickup_user_id IS NULL
           )
         ORDER BY te.end_time DESC
         LIMIT ? OFFSET ?`
      )
      .all(start, end, limit, offset);

    const total = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM time_entries te
         LEFT JOIN tasks t ON t.id = te.task_id
         LEFT JOIN ${DEDUPED_PROJECTS} np ON np.clickup_id = t.list_id
         LEFT JOIN ${DEDUPED_WORKERS} nw ON nw.clickup_user_id = te.user_id
         WHERE te.end_time IS NOT NULL
           AND te.start_time >= ? AND te.start_time <= ?
           ${DURATION_FILTER_SQL}
           AND (
             t.id IS NULL OR t.list_id IS NULL OR np.clickup_id IS NULL OR nw.clickup_user_id IS NULL
           )`
      )
      .get(start, end) as { count: number };

    res.json({ period, start, end, limit, offset, total: total.count, entries: rows });
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

earningsRouter.post('/backfill-tasks', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);

    const taskRows = db
      .prepare(
        `SELECT DISTINCT te.task_id as task_id
         FROM time_entries te
         LEFT JOIN tasks t ON t.id = te.task_id
         WHERE t.id IS NULL OR t.list_id IS NULL
         LIMIT ?`
      )
      .all(limit) as Array<{ task_id: string }>;

    if (taskRows.length === 0) {
      return res.json({ requested: 0, updated: 0, failed: 0, failed_task_ids: [] });
    }

    const failedTaskIds: string[] = [];
    let updated = 0;

    for (const row of taskRows) {
      const task = await fetchClickUpTask(row.task_id);
      if (!task) {
        failedTaskIds.push(row.task_id);
        continue;
      }

      upsertTask({
        id: task.id,
        name: task.name,
        status: task.status,
        list: task.list,
        folder: task.folder,
        space: task.space,
        url: task.url,
      });
      updated += 1;
    }

    res.json({
      requested: taskRows.length,
      updated,
      failed: failedTaskIds.length,
      failed_task_ids: failedTaskIds,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Błąd uzupełniania zadań z ClickUp',
      details: error instanceof Error ? error.message : 'Nieznany błąd',
    });
  }
});

earningsRouter.post('/import-time-entries', requireRole('admin'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { start, end, label } = resolveImportRange(req);
    const teamId = getClickUpTeamId();
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 200);
    const assigneeParam = (req.query.assignee as string | undefined) || (req.query.assignees as string | undefined);

    const startMs = start.getTime();
    const endMs = end.getTime();

    console.log(`\n📦 [IMPORT] Start importu time entries`);
    console.log(`   Zakres: ${start.toISOString().split('T')[0]} → ${end.toISOString().split('T')[0]} (${label})`);
    console.log(`   Team ID: ${teamId}, limit: ${limit}/stronę`);

    const taskCache = new Map<string, Awaited<ReturnType<typeof fetchClickUpTask>>>();
    let assigneeIds: string[] = [];

    if (assigneeParam) {
      assigneeIds = assigneeParam.split(',').map((id) => id.trim()).filter(Boolean);
      console.log(`   Assignees (ręcznie): ${assigneeIds.join(', ')}`);
    } else {
      console.log(`   Pobieram listę członków zespołu...`);
      const members = await fetchClickUpTeamMembers(teamId);
      assigneeIds = members.map((member) => String(member.id));
      console.log(`   Znaleziono ${members.length} członków: ${members.map(m => m.username).join(', ')}`);

      // Zapisz wszystkich członków do tabeli users, żeby lista była pełna
      for (const member of members) {
        upsertUser({
          id: String(member.id),
          username: member.username,
          email: member.email,
          color: member.color,
          profilePicture: member.profilePicture || undefined,
        });
      }
    }

    if (assigneeIds.length === 0) {
      throw new Error('Brak assignee do importu. Sprawdź uprawnienia tokena.');
    }

    const insertEntry = db.prepare(`
      INSERT INTO time_entries (
        id, task_id, task_name, user_id, user_name, user_email,
        start_time, end_time, duration, billable, description, task_url, list_name, folder_name, space_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        task_id = excluded.task_id,
        task_name = excluded.task_name,
        user_id = excluded.user_id,
        user_name = excluded.user_name,
        user_email = excluded.user_email,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        duration = excluded.duration,
        billable = excluded.billable,
        description = excluded.description,
        task_url = excluded.task_url,
        list_name = excluded.list_name,
        folder_name = excluded.folder_name,
        space_name = excluded.space_name
    `);

    const upsertEntries = db.transaction((items: Array<{
      id: string;
      task_id: string;
      task_name: string;
      user_id: string;
      user_name: string;
      user_email: string | null;
      start_time: string | null;
      end_time: string | null;
      duration: number;
      billable: number;
      description: string | null;
      task_url: string | null;
      list_name: string | null;
      folder_name: string | null;
      space_name: string | null;
    }>) => {
      for (const item of items) {
        insertEntry.run(
          item.id,
          item.task_id,
          item.task_name,
          item.user_id,
          item.user_name,
          item.user_email,
          item.start_time,
          item.end_time,
          item.duration,
          item.billable,
          item.description,
          item.task_url,
          item.list_name,
          item.folder_name,
          item.space_name
        );
      }
    });

    // Streaming response — wysyłaj postęp jako NDJSON, żeby proxy nie zabił połączenia
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no'); // wyłącz buforowanie w nginx/caddy
    res.flushHeaders();

    const sendProgress = (data: Record<string, unknown>) => {
      res.write(JSON.stringify(data) + '\n');
    };

    let totalFetched = 0;
    let totalSaved = 0;
    let skipped = 0;
    let totalPages = 0;

    let assigneeIndex = 0;
    for (const assigneeId of assigneeIds) {
      assigneeIndex++;
      let page = 0;
      let assigneeFetched = 0;
      const seenIds = new Set<string>();
      console.log(`\n   👤 [${assigneeIndex}/${assigneeIds.length}] Pobieram wpisy dla użytkownika ${assigneeId}...`);
      sendProgress({ type: 'progress', user: assigneeIndex, totalUsers: assigneeIds.length, assigneeId });

      while (true) {
        const entries = await fetchClickUpTimeEntries({
          teamId,
          startMs,
          endMs,
          page,
          limit,
          assignee: assigneeId,
          includeLocationNames: true,
        });

        if (entries.length === 0) {
          if (page === 0) console.log(`      Brak wpisów`);
          break;
        }

        // Wykrywanie duplikatów — ClickUp API potrafi zwracać te same wpisy w kółko
        let duplicates = 0;
        for (const entry of entries) {
          const eid = entry.id ? String(entry.id) : null;
          if (eid && seenIds.has(eid)) {
            duplicates++;
          } else if (eid) {
            seenIds.add(eid);
          }
        }
        if (duplicates > entries.length / 2) {
          console.log(`      ⚠️ Strona ${page + 1}: ${duplicates}/${entries.length} duplikatów — przerywam paginację`);
          break;
        }

        totalFetched += entries.length;
        assigneeFetched += entries.length;
        totalPages += 1;
        console.log(`      Strona ${page + 1}: ${entries.length} wpisów (łącznie: ${assigneeFetched})`);

        // Safety limit per user — zabezpieczenie przed nieskończoną paginacją API
        if (assigneeFetched >= MAX_IMPORT_ENTRIES_PER_USER) {
          console.log(`      ⚠️ Osiągnięto limit ${MAX_IMPORT_ENTRIES_PER_USER} wpisów dla użytkownika ${assigneeId} — przerywam`);
          break;
        }

        const normalized: Array<{
          id: string;
          task_id: string;
          task_name: string;
          user_id: string;
          user_name: string;
          user_email: string | null;
          start_time: string | null;
          end_time: string | null;
          duration: number;
          billable: number;
          description: string | null;
          task_url: string | null;
          list_name: string | null;
          folder_name: string | null;
          space_name: string | null;
        }> = [];

        for (const entry of entries) {
          const entryId = entry.id ? String(entry.id) : null;
          const taskId = entry.task?.id || entry.task_id;
          const user = entry.user;
          const userId = user?.id ?? entry.user_id;

          if (!entryId || !taskId || !userId) {
            skipped += 1;
            continue;
          }

          const startValue = Number(entry.start ?? (entry as any).start_time);
          const endValue = Number(entry.end ?? (entry as any).end_time);
          const durationValue = Number(entry.duration ?? 0);

          // Pomijaj wpisy z absurdalnie długim czasem (np. zostawiony timer na kilka dni)
          if (durationValue > MAX_ENTRY_DURATION_MS) {
            const hrs = Math.round(durationValue / 3600000);
            console.log(`      ⚠️ Pomijam wpis ${entryId}: ${hrs}h (max ${MAX_ENTRY_DURATION_MS / 3600000}h)`);
            skipped += 1;
            continue;
          }

          const startIso = Number.isFinite(startValue) ? new Date(startValue).toISOString() : null;
          const endIso = Number.isFinite(endValue) ? new Date(endValue).toISOString() : null;

          const taskIdStr = String(taskId);
          let taskDetails = taskCache.get(taskIdStr);
          if (!taskDetails) {
            taskDetails = await fetchClickUpTask(taskIdStr);
            taskCache.set(taskIdStr, taskDetails);
            if (taskDetails) {
              upsertTask({
                id: taskDetails.id,
                name: taskDetails.name,
                status: taskDetails.status,
                list: taskDetails.list,
                folder: taskDetails.folder,
                space: taskDetails.space,
                url: taskDetails.url,
              });
            }
          }

          if (user?.id) {
            upsertUser({
              id: String(user.id),
              username: user.username,
              email: user.email,
              color: user.color,
              profilePicture: user.profilePicture || undefined,
            });
          }

          normalized.push({
            id: entryId,
            task_id: taskIdStr,
            task_name: taskDetails?.name || entry.task?.name || `Zadanie ${taskIdStr}`,
            user_id: String(userId),
            user_name: user?.username || String(userId),
            user_email: user?.email || null,
            start_time: startIso,
            end_time: endIso,
            duration: Number.isFinite(durationValue) ? durationValue : 0,
            billable: entry.billable ? 1 : 0,
            description: entry.description || null,
            task_url: taskDetails?.url || entry.task?.url || `https://app.clickup.com/t/${taskIdStr}`,
            list_name: taskDetails?.list?.name || null,
            folder_name: taskDetails?.folder?.name || null,
            space_name: taskDetails?.space?.name || null,
          });
        }

        upsertEntries(normalized);
        totalSaved += normalized.length;

        // Wysyłaj postęp co 10 stron
        if (totalPages % 10 === 0) {
          sendProgress({ type: 'progress', user: assigneeIndex, totalUsers: assigneeIds.length, fetched: totalFetched, saved: totalSaved });
        }

        if (entries.length < limit) {
          break;
        }
        page += 1;
      }
    }

    console.log(`\n✅ [IMPORT] Zakończono!`);
    console.log(`   Pobrano: ${totalFetched} wpisów, Zapisano: ${totalSaved}, Pominięto: ${skipped}`);
    console.log(`   Stron API: ${totalPages}, Członków: ${assigneeIds.length}, Tasków w cache: ${taskCache.size}\n`);

    const result = {
      type: 'done' as const,
      range: label,
      start: start.toISOString(),
      end: end.toISOString(),
      fetched: totalFetched,
      saved: totalSaved,
      skipped,
      pages: totalPages,
      assignees: assigneeIds.length,
    };
    sendProgress(result);
    res.end();
  } catch (error) {
    console.error(`\n❌ [IMPORT] Błąd:`, error instanceof Error ? error.message : error);
    try {
      const errPayload = {
        type: 'error' as const,
        error: 'Błąd importu historii time trackingu',
        details: error instanceof Error ? error.message : 'Nieznany błąd',
      };
      res.write(JSON.stringify(errPayload) + '\n');
      res.end();
    } catch {
      // response already ended
    }
  }
});
