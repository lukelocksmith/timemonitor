import { Router, Response } from 'express';
import { getAppUserByUsername, getAppUserById, updateLastLogin, updateAppUserPassword } from '../database.js';
import { verifyPassword, hashPassword } from '../auth/password.js';
import { signToken } from '../auth/jwt.js';
import { requireAuth } from '../auth/middleware.js';
import { AuthenticatedRequest, LoginRequest, ChangePasswordRequest } from '../types/auth.js';

export const authRouter = Router();

// POST /auth/login - Logowanie
authRouter.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body as LoginRequest;

    if (!username || !password) {
      return res.status(400).json({ error: 'Wymagany username i password' });
    }

    const user = getAppUserByUsername(username);

    if (!user) {
      return res.status(401).json({ error: 'Nieprawidłowy login lub hasło' });
    }

    if (!user.is_active) {
      return res.status(401).json({ error: 'Konto jest nieaktywne' });
    }

    const isValid = await verifyPassword(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ error: 'Nieprawidłowy login lub hasło' });
    }

    // Aktualizuj last_login
    updateLastLogin(user.id);

    // Generuj token
    const token = signToken({
      userId: user.id,
      username: user.username,
      role: user.role,
    });

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        display_name: user.display_name,
        clickup_user_id: user.clickup_user_id,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Błąd serwera podczas logowania' });
  }
});

// GET /auth/me - Dane zalogowanego użytkownika
authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  const user = getAppUserById(req.user!.userId);

  if (!user || !user.is_active) {
    return res.status(401).json({ error: 'Użytkownik nie istnieje lub jest nieaktywny' });
  }

  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    display_name: user.display_name,
    clickup_user_id: user.clickup_user_id,
    last_login: user.last_login,
  });
});

// POST /auth/change-password - Zmiana hasła
authRouter.post('/change-password', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { currentPassword, newPassword } = req.body as ChangePasswordRequest;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Wymagane obecne i nowe hasło' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Nowe hasło musi mieć minimum 6 znaków' });
  }

  const user = getAppUserById(req.user!.userId);

  if (!user) {
    return res.status(401).json({ error: 'Użytkownik nie istnieje' });
  }

  const isValid = await verifyPassword(currentPassword, user.password_hash);

  if (!isValid) {
    return res.status(401).json({ error: 'Nieprawidłowe obecne hasło' });
  }

  const newHash = await hashPassword(newPassword);
  updateAppUserPassword(user.id, newHash);

  res.json({ message: 'Hasło zostało zmienione' });
});
