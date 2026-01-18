import { Router, Request, Response } from 'express';
import { db } from '../database.js';
import { requireAuth } from '../auth/middleware.js';
import { getScope, requireWorkerLink } from '../auth/scope.js';

export const apiRouter = Router();

function backfillMissingListNames() {
  // Uzupełnij brakujące list_name na podstawie tabeli tasks.
  db.prepare(`
    UPDATE time_entries
    SET list_name = (
      SELECT t.list_name
      FROM tasks t
      WHERE t.id = time_entries.task_id
    )
    WHERE (list_name IS NULL OR list_name = '')
      AND task_id IN (
        SELECT id FROM tasks WHERE list_name IS NOT NULL AND list_name != ''
      )
  `).run();
}

// Wszystkie endpointy API wymagają autoryzacji
apiRouter.use(requireAuth);

// Pobierz aktywne sesje (kto teraz pracuje)
apiRouter.get('/active', (req: Request, res: Response) => {
  const scope = getScope(req as any);
  let whereClause = 'te.end_time IS NULL';
  const params: (string | number)[] = [];

  if (scope.isUser) {
    const clickupUserId = requireWorkerLink(scope.appUser);
    if (!clickupUserId) {
      return res.status(403).json({ error: 'Brak powiązania z pracownikiem (ClickUp)' });
    }
    if (!clickupUserId) {
      return res.status(403).json({ error: 'Brak powiązania z pracownikiem (ClickUp)' });
    }
    whereClause += ' AND te.user_id = ?';
    params.push(clickupUserId);
  }

  const sessions = db
    .prepare(
      `SELECT
        te.*,
        u.color as user_color,
        u.profile_picture as user_avatar
       FROM time_entries te
       LEFT JOIN users u ON te.user_id = u.id
       WHERE ${whereClause}
       ORDER BY te.start_time DESC`
    )
    .all(...params);

  res.json(sessions);
});

// Pobierz historię (ostatnie wpisy)
apiRouter.get('/history', (req: Request, res: Response) => {
  backfillMissingListNames();
  const scope = getScope(req as any);
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  const startParam = req.query.start as string | undefined;
  const endParam = req.query.end as string | undefined;

  if ((startParam && !endParam) || (!startParam && endParam)) {
    return res.status(400).json({ error: 'Parametry start i end muszą być podane razem' });
  }

  const params: (string | number)[] = [];
  let whereClause = 'te.end_time IS NOT NULL';

  if (startParam && endParam) {
    const startDate = new Date(startParam);
    const endDate = new Date(endParam);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Nieprawidłowy format daty' });
    }
    whereClause += ' AND te.start_time >= ? AND te.start_time <= ?';
    params.push(startDate.toISOString(), endDate.toISOString());
  }

  if (scope.isUser) {
    const clickupUserId = requireWorkerLink(scope.appUser);
    if (!clickupUserId) {
      return res.status(403).json({ error: 'Brak powiązania z pracownikiem (ClickUp)' });
    }
    whereClause += ' AND te.user_id = ?';
    params.push(clickupUserId);
  }

  params.push(limit, offset);

  const entries = db
    .prepare(
      `SELECT
        te.*,
        u.color as user_color,
        u.profile_picture as user_avatar
       FROM time_entries te
       LEFT JOIN users u ON te.user_id = u.id
       WHERE ${whereClause}
       ORDER BY te.end_time DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params);

  const total = db
    .prepare(`SELECT COUNT(*) as count FROM time_entries te WHERE ${whereClause}`)
    .get(...params.slice(0, params.length - 2)) as { count: number };

  res.json({
    entries,
    total: total.count,
    limit,
    offset,
  });
});

// Pobierz statystyki użytkownika
apiRouter.get('/user/:userId/stats', (req: Request, res: Response) => {
  const scope = getScope(req as any);
  const userIdParam = req.params.userId;
  const userId = scope.isUser ? requireWorkerLink(scope.appUser) : userIdParam;
  if (scope.isUser && !userId) {
    return res.status(403).json({ error: 'Brak powiązania z pracownikiem (ClickUp)' });
  }
  if (scope.isUser && userIdParam !== userId) {
    return res.status(403).json({ error: 'Brak uprawnień do tych danych' });
  }
  const days = parseInt(req.query.days as string) || 7;

  const stats = db
    .prepare(
      `SELECT
        COUNT(*) as total_entries,
        SUM(duration) as total_duration,
        COUNT(DISTINCT task_id) as unique_tasks
       FROM time_entries
       WHERE user_id = ?
         AND start_time >= datetime('now', '-' || ? || ' days')`
    )
    .get(userId, days);

  const byTask = db
    .prepare(
      `SELECT
        task_id,
        task_name,
        SUM(duration) as total_duration,
        COUNT(*) as entries_count
       FROM time_entries
       WHERE user_id = ?
         AND start_time >= datetime('now', '-' || ? || ' days')
       GROUP BY task_id
       ORDER BY total_duration DESC
       LIMIT 10`
    )
    .all(userId, days);

  res.json({ stats, byTask });
});

// Pobierz wszystkich użytkowników
apiRouter.get('/users', (req: Request, res: Response) => {
  const scope = getScope(req as any);
  let whereClause = '';
  const params: (string | number)[] = [];

  if (scope.isUser) {
    const clickupUserId = requireWorkerLink(scope.appUser);
    if (!clickupUserId) {
      return res.status(403).json({ error: 'Brak powiązania z pracownikiem (ClickUp)' });
    }
    whereClause = 'WHERE u.id = ?';
    params.push(clickupUserId);
  }

  const users = db
    .prepare(
      `SELECT
        u.*,
        (SELECT COUNT(*) FROM time_entries WHERE user_id = u.id AND end_time IS NULL) as is_active,
        (SELECT task_name FROM time_entries WHERE user_id = u.id AND end_time IS NULL LIMIT 1) as current_task
       FROM users u
       ${whereClause}
       ORDER BY u.username`
    )
    .all(...params);

  res.json(users);
});

// Statystyki dzisiejsze
apiRouter.get('/stats/today', (req: Request, res: Response) => {
  const scope = getScope(req as any);
  const today = new Date().toISOString().split('T')[0];
  const userFilter = scope.isUser ? requireWorkerLink(scope.appUser) : null;
  if (scope.isUser && !userFilter) {
    return res.status(403).json({ error: 'Brak powiązania z pracownikiem (ClickUp)' });
  }
  const userCondition = userFilter ? 'AND user_id = ?' : '';
  const userParams = userFilter ? [userFilter] : [];

  const stats = db
    .prepare(
      `SELECT
        COUNT(DISTINCT user_id) as active_users,
        COUNT(*) as total_entries,
        SUM(CASE WHEN end_time IS NULL THEN 1 ELSE 0 END) as currently_active,
        SUM(duration) as total_duration
       FROM time_entries
       WHERE date(start_time) = ?
       ${userCondition}`
    )
    .get(today, ...userParams);

  const byUser = db
    .prepare(
      `SELECT
        user_id,
        user_name,
        COUNT(*) as entries_count,
        SUM(duration) as total_duration,
        (SELECT end_time IS NULL FROM time_entries t2
         WHERE t2.user_id = time_entries.user_id
         ORDER BY start_time DESC LIMIT 1) as is_active
       FROM time_entries
       WHERE date(start_time) = ?
       ${userCondition}
       GROUP BY user_id
       ORDER BY total_duration DESC`
    )
    .all(today, ...userParams);

  res.json({ stats, byUser });
});

// Helper: oblicz zakres dat
function getDateRange(period: string): { start: string; end: string } {
  const now = new Date();
  let start: Date;
  let end: Date = now;

  switch (period) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'week':
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Poniedziałek = start tygodnia
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
      break;
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'last_month':
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      break;
    default:
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

// Statystyki wszystkich użytkowników z filtrem czasowym
apiRouter.get('/stats/team', (req: Request, res: Response) => {
  const scope = getScope(req as any);
  const period = req.query.period as string | undefined;
  const startParam = req.query.start as string | undefined;
  const endParam = req.query.end as string | undefined;

  let start: string;
  let end: string;

  // Jeśli podano start i end, użyj ich (custom range)
  if (startParam && endParam) {
    // Zakładamy format YYYY-MM-DD, konwertujemy na pełne ISO
    const startDate = new Date(startParam);
    const endDate = new Date(endParam);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Nieprawidłowy format daty' });
    }
    start = startDate.toISOString();
    end = endDate.toISOString();
  } else {
    // Użyj predefiniowanego okresu
    const range = getDateRange(period || 'today');
    start = range.start;
    end = range.end;
  }

  if (scope.isUser) {
    const clickupUserId = requireWorkerLink(scope.appUser);
    const user = db
      .prepare(
        `SELECT
          u.id,
          u.username,
          u.email,
          u.color,
          u.profile_picture,
          COALESCE(SUM(te.duration), 0) as total_duration,
          COUNT(te.id) as entries_count,
          COUNT(DISTINCT te.task_id) as unique_tasks
         FROM users u
         LEFT JOIN time_entries te ON u.id = te.user_id
           AND te.start_time >= ? AND te.start_time <= ?
           AND te.end_time IS NOT NULL
         WHERE u.id = ?
         GROUP BY u.id`
      )
      .all(start, end, clickupUserId);

    const totals = db
      .prepare(
        `SELECT
          COALESCE(SUM(duration), 0) as total_duration,
          COUNT(*) as total_entries,
          COUNT(DISTINCT user_id) as active_users
         FROM time_entries
         WHERE start_time >= ? AND start_time <= ?
           AND end_time IS NOT NULL
           AND user_id = ?`
      )
      .get(start, end, clickupUserId);

    return res.json({
      period: startParam && endParam ? 'custom' : (period || 'today'),
      start,
      end,
      users: user,
      totals,
    });
  }

  const users = db
    .prepare(
      `SELECT
        u.id,
        u.username,
        u.email,
        u.color,
        u.profile_picture,
        COALESCE(SUM(te.duration), 0) as total_duration,
        COUNT(te.id) as entries_count,
        COUNT(DISTINCT te.task_id) as unique_tasks
       FROM users u
       LEFT JOIN time_entries te ON u.id = te.user_id
         AND te.start_time >= ? AND te.start_time <= ?
         AND te.end_time IS NOT NULL
       GROUP BY u.id
       ORDER BY total_duration DESC`
    )
    .all(start, end);

  const totals = db
    .prepare(
      `SELECT
        COALESCE(SUM(duration), 0) as total_duration,
        COUNT(*) as total_entries,
        COUNT(DISTINCT user_id) as active_users
       FROM time_entries
       WHERE start_time >= ? AND start_time <= ?
         AND end_time IS NOT NULL`
    )
    .get(start, end);

  res.json({
    period: startParam && endParam ? 'custom' : (period || 'today'),
    start,
    end,
    users,
    totals,
  });
});

// Historia z filtrem po użytkowniku
apiRouter.get('/history/filtered', (req: Request, res: Response) => {
  backfillMissingListNames();
  const scope = getScope(req as any);
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;
  const userId = scope.isUser ? requireWorkerLink(scope.appUser) : (req.query.user_id as string | undefined);
  if (scope.isUser && !userId) {
    return res.status(403).json({ error: 'Brak powiązania z pracownikiem (ClickUp)' });
  }
  const startParam = req.query.start as string | undefined;
  const endParam = req.query.end as string | undefined;

  if ((startParam && !endParam) || (!startParam && endParam)) {
    return res.status(400).json({ error: 'Parametry start i end muszą być podane razem' });
  }

  let query = `
    SELECT
      te.*,
      u.color as user_color,
      u.profile_picture as user_avatar
    FROM time_entries te
    LEFT JOIN users u ON te.user_id = u.id
    WHERE te.end_time IS NOT NULL
  `;

  const params: (string | number)[] = [];

  if (userId) {
    query += ` AND te.user_id = ?`;
    params.push(userId);
  }

  if (startParam && endParam) {
    const startDate = new Date(startParam);
    const endDate = new Date(endParam);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Nieprawidłowy format daty' });
    }
    query += ` AND te.start_time >= ? AND te.start_time <= ?`;
    params.push(startDate.toISOString(), endDate.toISOString());
  }

  query += ` ORDER BY te.end_time DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const entries = db.prepare(query).all(...params);

  let countQuery = `SELECT COUNT(*) as count FROM time_entries WHERE end_time IS NOT NULL`;
  const countParams: string[] = [];

  if (userId) {
    countQuery += ` AND user_id = ?`;
    countParams.push(userId);
  }

  if (startParam && endParam) {
    const startDate = new Date(startParam);
    const endDate = new Date(endParam);
    countQuery += ` AND start_time >= ? AND start_time <= ?`;
    countParams.push(startDate.toISOString(), endDate.toISOString());
  }

  const total = db.prepare(countQuery).get(...countParams) as { count: number };

  res.json({
    entries,
    total: total.count,
    limit,
    offset,
    user_id: userId || null,
  });
});
