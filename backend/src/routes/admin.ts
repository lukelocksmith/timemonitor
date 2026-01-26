import { Router, Response } from 'express';
import {
  db,
  getAllAppUsers,
  getAppUserById,
  getAppUserByUsername,
  createAppUser,
  updateAppUser,
  updateAppUserPassword,
  getAllSettings,
  getSetting,
  setSetting,
  deleteSetting,
} from '../database.js';
import { getConfig } from '../config.js';
import { hashPassword } from '../auth/password.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { AuthenticatedRequest, CreateUserRequest, UpdateUserRequest } from '../types/auth.js';

export const adminRouter = Router();

// Wszystkie endpointy wymagają admina
adminRouter.use(requireAuth, requireRole('admin'));

// GET /admin/users - Lista wszystkich użytkowników
adminRouter.get('/users', (req: AuthenticatedRequest, res: Response) => {
  const users = getAllAppUsers();
  res.json(users);
});

// POST /admin/users - Utwórz nowego użytkownika
adminRouter.post('/users', async (req: AuthenticatedRequest, res: Response) => {
  const { username, password, role, display_name, clickup_user_id } = req.body as CreateUserRequest;

  if (!username || !password) {
    return res.status(400).json({ error: 'Wymagany username i password' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Hasło musi mieć minimum 6 znaków' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: 'Username musi mieć minimum 3 znaki' });
  }

  // Sprawdź czy username już istnieje
  const existing = getAppUserByUsername(username);
  if (existing) {
    return res.status(409).json({ error: 'Username już istnieje' });
  }

  const validRoles = ['admin', 'pm', 'user'];
  const userRole = role && validRoles.includes(role) ? role : 'user';

  if (userRole !== 'admin' && !clickup_user_id) {
    return res.status(400).json({ error: 'Wymagane powiązanie z pracownikiem (ClickUp)' });
  }

  const passwordHash = await hashPassword(password);
  const userId = createAppUser(username, passwordHash, userRole, display_name, clickup_user_id || null);

  res.status(201).json({
    id: userId,
    username,
    role: userRole,
    display_name: display_name || null,
    clickup_user_id: clickup_user_id || null,
    is_active: 1,
    message: 'Użytkownik utworzony',
  });
});

// GET /admin/users/:id - Szczegóły użytkownika
adminRouter.get('/users/:id', (req: AuthenticatedRequest, res: Response) => {
  const id = parseInt(req.params.id as string);

  if (isNaN(id)) {
    return res.status(400).json({ error: 'Nieprawidłowe ID' });
  }

  const user = getAppUserById(id);

  if (!user) {
    return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
  }

  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    display_name: user.display_name,
    clickup_user_id: user.clickup_user_id,
    is_active: user.is_active,
    created_at: user.created_at,
    last_login: user.last_login,
  });
});

// PUT /admin/users/:id - Edycja użytkownika
adminRouter.put('/users/:id', (req: AuthenticatedRequest, res: Response) => {
  const id = parseInt(req.params.id as string);

  if (isNaN(id)) {
    return res.status(400).json({ error: 'Nieprawidłowe ID' });
  }

  const user = getAppUserById(id);

  if (!user) {
    return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
  }

  const { display_name, role, is_active, clickup_user_id } = req.body as UpdateUserRequest;

  const updates: { display_name?: string; role?: string; is_active?: number; clickup_user_id?: string | null } = {};

  if (display_name !== undefined) {
    updates.display_name = display_name;
  }

  if (role !== undefined) {
    const validRoles = ['admin', 'pm', 'user'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Nieprawidłowa rola' });
    }
    // Nie pozwól adminowi zdegradować samego siebie
    if (user.id === req.user!.userId && role !== 'admin') {
      return res.status(400).json({ error: 'Nie możesz zmienić własnej roli' });
    }
    updates.role = role;
  }

  if (clickup_user_id !== undefined) {
    updates.clickup_user_id = clickup_user_id || null;
  }

  const effectiveRole = updates.role || user.role;
  const effectiveClickupId =
    updates.clickup_user_id !== undefined ? updates.clickup_user_id : user.clickup_user_id;
  if (effectiveRole !== 'admin' && !effectiveClickupId) {
    return res.status(400).json({ error: 'Wymagane powiązanie z pracownikiem (ClickUp)' });
  }

  if (is_active !== undefined) {
    // Nie pozwól adminowi dezaktywować samego siebie
    if (user.id === req.user!.userId && !is_active) {
      return res.status(400).json({ error: 'Nie możesz dezaktywować własnego konta' });
    }
    updates.is_active = is_active ? 1 : 0;
  }

  updateAppUser(id, updates);

  res.json({ message: 'Użytkownik zaktualizowany' });
});

// DELETE /admin/users/:id - Dezaktywacja użytkownika (soft delete)
adminRouter.delete('/users/:id', (req: AuthenticatedRequest, res: Response) => {
  const id = parseInt(req.params.id as string);

  if (isNaN(id)) {
    return res.status(400).json({ error: 'Nieprawidłowe ID' });
  }

  const user = getAppUserById(id);

  if (!user) {
    return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
  }

  // Nie pozwól adminowi usunąć samego siebie
  if (user.id === req.user!.userId) {
    return res.status(400).json({ error: 'Nie możesz usunąć własnego konta' });
  }

  updateAppUser(id, { is_active: 0 });

  res.json({ message: 'Użytkownik dezaktywowany' });
});

// POST /admin/users/:id/reset-password - Reset hasła użytkownika
adminRouter.post('/users/:id/reset-password', async (req: AuthenticatedRequest, res: Response) => {
  const id = parseInt(req.params.id as string);
  const { newPassword } = req.body;

  if (isNaN(id)) {
    return res.status(400).json({ error: 'Nieprawidłowe ID' });
  }

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Nowe hasło musi mieć minimum 6 znaków' });
  }

  const user = getAppUserById(id);

  if (!user) {
    return res.status(404).json({ error: 'Użytkownik nie znaleziony' });
  }

  const passwordHash = await hashPassword(newPassword);
  updateAppUserPassword(id, passwordHash);

  res.json({ message: 'Hasło zostało zresetowane' });
});

// POST /admin/fix-durations - Napraw wpisy z duration=0
adminRouter.post('/fix-durations', (req: AuthenticatedRequest, res: Response) => {
  // Znajdź wpisy z duration=0 które mają start_time i end_time
  const brokenEntries = db
    .prepare(
      `SELECT id, task_name, user_name, start_time, end_time, duration
       FROM time_entries
       WHERE (duration IS NULL OR duration = 0)
         AND end_time IS NOT NULL
         AND start_time IS NOT NULL`
    )
    .all() as Array<{
    id: string;
    task_name: string;
    user_name: string;
    start_time: string;
    end_time: string;
    duration: number | null;
  }>;

  if (brokenEntries.length === 0) {
    return res.json({ message: 'Brak wpisów do naprawy', fixed: 0 });
  }

  // Napraw każdy wpis
  const updateStmt = db.prepare('UPDATE time_entries SET duration = ? WHERE id = ?');
  let fixed = 0;

  for (const entry of brokenEntries) {
    const startMs = new Date(entry.start_time).getTime();
    const endMs = new Date(entry.end_time).getTime();

    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      const durationMs = endMs - startMs;
      updateStmt.run(durationMs, entry.id);
      fixed++;
      console.log(
        `🔧 Naprawiono: ${entry.user_name} - ${entry.task_name}: ${Math.round(durationMs / 1000 / 60)}min`
      );
    }
  }

  res.json({
    message: `Naprawiono ${fixed} z ${brokenEntries.length} wpisów`,
    fixed,
    total: brokenEntries.length,
  });
});

// ── Settings endpoints ───────────────────────────────────────────────

/** Klucze które można edytować z poziomu UI */
const ALLOWED_SETTINGS: Record<string, { description: string; is_secret: boolean; is_restart_required: boolean }> = {
  CLICKUP_API_TOKEN:   { description: 'Token API ClickUp',            is_secret: true,  is_restart_required: false },
  CLICKUP_TEAM_ID:     { description: 'ID zespołu ClickUp',           is_secret: false, is_restart_required: false },
  CLICKUP_WEBHOOK_SECRET: { description: 'Webhook secret ClickUp',    is_secret: true,  is_restart_required: false },
  NOTION_API_KEY:      { description: 'Token API Notion',             is_secret: true,  is_restart_required: false },
  NOTION_VERSION:      { description: 'Wersja API Notion',            is_secret: false, is_restart_required: false },
  NOTION_WORKERS_DS:   { description: 'Data source ID workers',       is_secret: false, is_restart_required: false },
  NOTION_PROJECTS_DS:  { description: 'Data source ID projects',      is_secret: false, is_restart_required: false },
  NOTION_WORKERS_DB:   { description: 'Database ID workers (Notion)', is_secret: false, is_restart_required: false },
  NOTION_PROJECTS_DB:  { description: 'Database ID projects (Notion)',is_secret: false, is_restart_required: false },
  FRONTEND_URL:        { description: 'URL frontendu (CORS)',         is_secret: false, is_restart_required: true  },
  // Startup-only (read-only in UI)
  JWT_SECRET:          { description: 'Secret JWT (zmiana wymaga restartu)', is_secret: true,  is_restart_required: true },
  PORT:                { description: 'Port serwera HTTP',            is_secret: false, is_restart_required: true  },
  DB_PATH:             { description: 'Ścieżka do bazy SQLite',      is_secret: false, is_restart_required: true  },
  ADMIN_USERNAME:      { description: 'Login admina (seed)',          is_secret: false, is_restart_required: true  },
  ADMIN_PASSWORD:      { description: 'Hasło admina (seed)',          is_secret: true,  is_restart_required: true  },
};

const STARTUP_ONLY_KEYS = new Set(['JWT_SECRET', 'PORT', 'DB_PATH', 'ADMIN_USERNAME', 'ADMIN_PASSWORD']);

function maskValue(value: string): string {
  if (value.length <= 8) return '••••••••';
  return value.slice(0, 5) + '•••' + value.slice(-4);
}

// GET /admin/settings — lista wszystkich ustawień
adminRouter.get('/settings', (_req: AuthenticatedRequest, res: Response) => {
  const dbSettings = getAllSettings();
  const dbMap = new Map(dbSettings.map((s) => [s.key, s]));

  const result: Array<{
    key: string;
    value: string | null;
    maskedValue: string | null;
    source: 'db' | 'env' | 'default';
    is_secret: boolean;
    description: string;
    is_restart_required: boolean;
    updated_at: string | null;
  }> = [];

  for (const [key, meta] of Object.entries(ALLOWED_SETTINGS)) {
    const dbRow = dbMap.get(key);
    const envValue = process.env[key] ?? null;

    let value: string | null;
    let source: 'db' | 'env' | 'default';

    if (dbRow) {
      value = dbRow.value;
      source = 'db';
    } else if (envValue) {
      value = envValue;
      source = 'env';
    } else {
      value = null;
      source = 'default';
    }

    result.push({
      key,
      value: meta.is_secret ? null : value,
      maskedValue: value ? (meta.is_secret ? maskValue(value) : value) : null,
      source,
      is_secret: meta.is_secret,
      description: meta.description,
      is_restart_required: meta.is_restart_required,
      updated_at: dbRow?.updated_at ?? null,
    });
  }

  res.json(result);
});

// PUT /admin/settings/:key — upsert wartości
adminRouter.put('/settings/:key', (req: AuthenticatedRequest, res: Response) => {
  const key = req.params.key as string;
  const { value } = req.body;

  if (!ALLOWED_SETTINGS[key]) {
    return res.status(400).json({ error: `Niedozwolony klucz: ${key}` });
  }

  if (STARTUP_ONLY_KEYS.has(key)) {
    return res.status(400).json({ error: `Klucz ${key} wymaga restartu — edycja zablokowana` });
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return res.status(400).json({ error: 'Wartość nie może być pusta' });
  }

  const meta = ALLOWED_SETTINGS[key];
  setSetting(key, value.trim(), meta.description, meta.is_secret);

  res.json({ key, message: 'Zaktualizowano' });
});

// DELETE /admin/settings/:key — usunięcie (powrót do .env fallback)
adminRouter.delete('/settings/:key', (req: AuthenticatedRequest, res: Response) => {
  const key = req.params.key as string;

  if (!ALLOWED_SETTINGS[key]) {
    return res.status(400).json({ error: `Niedozwolony klucz: ${key}` });
  }

  deleteSetting(key);

  res.json({ key, message: 'Usunięto z DB — aktywna wartość z .env' });
});

// POST /admin/settings/test-clickup — test połączenia z ClickUp API
adminRouter.post('/settings/test-clickup', async (_req: AuthenticatedRequest, res: Response) => {
  const token = getConfig('CLICKUP_API_TOKEN');
  if (!token) {
    return res.json({ success: false, message: 'Brak CLICKUP_API_TOKEN' });
  }

  try {
    const response = await fetch('https://api.clickup.com/api/v2/team', {
      headers: { Authorization: token },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.json({ success: false, message: `HTTP ${response.status}: ${text.slice(0, 200)}` });
    }

    const data = await response.json();
    const teamCount = Array.isArray(data?.teams) ? data.teams.length : 0;
    res.json({ success: true, message: `Połączono — znaleziono ${teamCount} zespół(ów)` });
  } catch (err) {
    res.json({ success: false, message: `Błąd: ${err instanceof Error ? err.message : String(err)}` });
  }
});

// POST /admin/settings/test-notion — test połączenia z Notion API
adminRouter.post('/settings/test-notion', async (_req: AuthenticatedRequest, res: Response) => {
  const token = getConfig('NOTION_API_KEY');
  if (!token) {
    return res.json({ success: false, message: 'Brak NOTION_API_KEY' });
  }

  const notionVersion = getConfig('NOTION_VERSION', '2022-06-28')!;

  try {
    const response = await fetch('https://api.notion.com/v1/users', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': notionVersion,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.json({ success: false, message: `HTTP ${response.status}: ${text.slice(0, 200)}` });
    }

    const data = await response.json();
    const userCount = Array.isArray(data?.results) ? data.results.length : 0;
    res.json({ success: true, message: `Połączono — znaleziono ${userCount} użytkownik(ów)` });
  } catch (err) {
    res.json({ success: false, message: `Błąd: ${err instanceof Error ? err.message : String(err)}` });
  }
});

// ── Projects (is_internal toggle) ────────────────────────────────────

// GET /admin/projects — lista projektów z flagą is_internal
adminRouter.get('/projects', (_req: AuthenticatedRequest, res: Response) => {
  const projects = db
    .prepare(
      `SELECT id, notion_page_id, clickup_id, name, hourly_rate, monthly_budget,
              status, tags, is_internal
       FROM notion_projects
       ORDER BY name`
    )
    .all();
  res.json(projects);
});

// PATCH /admin/projects/:id/internal — przełącz is_internal
adminRouter.patch('/projects/:id/internal', (req: AuthenticatedRequest, res: Response) => {
  const id = parseInt(req.params.id as string);
  const { is_internal } = req.body as { is_internal: boolean };

  if (typeof is_internal !== 'boolean') {
    return res.status(400).json({ error: 'Wymagane pole is_internal (boolean)' });
  }

  const result = db
    .prepare('UPDATE notion_projects SET is_internal = ? WHERE id = ?')
    .run(is_internal ? 1 : 0, id);

  if (result.changes === 0) {
    return res.status(404).json({ error: 'Projekt nie znaleziony' });
  }

  res.json({ id, is_internal, message: is_internal ? 'Oznaczono jako wewnętrzny' : 'Oznaczono jako kliencki' });
});
