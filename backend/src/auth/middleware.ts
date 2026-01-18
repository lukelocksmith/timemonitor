import { Response, NextFunction } from 'express';
import { verifyToken } from './jwt.js';
import { AuthenticatedRequest, UserRole } from '../types/auth.js';

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Brak tokena autoryzacji' });
  }

  const token = authHeader.substring(7);
  const payload = verifyToken(token);

  if (!payload) {
    return res.status(401).json({ error: 'Nieprawidłowy lub wygasły token' });
  }

  req.user = payload;
  next();
}

export function requireRole(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Brak autoryzacji' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Brak uprawnień do tej operacji' });
    }

    next();
  };
}
