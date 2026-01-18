import { getAppUserById } from '../database.js';
import { AuthenticatedRequest, AppUser } from '../types/auth.js';

export function getRequestingUser(req: AuthenticatedRequest): AppUser {
  if (!req.user) {
    throw new Error('Brak autoryzacji');
  }

  const appUser = getAppUserById(req.user.userId);
  if (!appUser || !appUser.is_active) {
    throw new Error('Użytkownik nie istnieje lub jest nieaktywny');
  }

  return appUser;
}

export function requireWorkerLink(appUser: AppUser): string | null {
  if (appUser.role === 'admin') {
    return null;
  }

  if (!appUser.clickup_user_id) {
    return null;
  }

  return appUser.clickup_user_id;
}

export function getScope(req: AuthenticatedRequest) {
  const appUser = getRequestingUser(req);
  const isAdmin = appUser.role === 'admin';
  const isPm = appUser.role === 'pm';
  const isUser = appUser.role === 'user';

  return {
    appUser,
    isAdmin,
    isPm,
    isUser,
    clickupUserId: appUser.clickup_user_id,
  };
}
