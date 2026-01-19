import { Router, Response } from 'express';
import {
  db,
  getAllAppUsers,
  getAppUserById,
  getAppUserByUsername,
  createAppUser,
  updateAppUser,
  updateAppUserPassword,
} from '../database.js';
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
