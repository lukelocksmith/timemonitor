import { Request } from 'express';

export type UserRole = 'admin' | 'pm' | 'user';

export interface AppUser {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  display_name: string | null;
  clickup_user_id: string | null;
  is_active: number;
  created_at: string;
  last_login: string | null;
}

export interface AppUserPublic {
  id: number;
  username: string;
  role: UserRole;
  display_name: string | null;
  clickup_user_id: string | null;
  is_active: number;
  created_at: string;
  last_login: string | null;
}

export interface JWTPayload {
  userId: number;
  username: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  role?: UserRole;
  display_name?: string;
  clickup_user_id?: string | null;
}

export interface UpdateUserRequest {
  display_name?: string;
  role?: UserRole;
  is_active?: boolean;
  clickup_user_id?: string | null;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
