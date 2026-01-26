import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { hashPassword } from './auth/password.js';
import { AppUser, AppUserPublic } from './types/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'activity.db');

// Upewnij się że katalog istnieje
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

export async function initDatabase() {
  // Tabela użytkowników ClickUp
  db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT,
      email TEXT,
      color TEXT,
      profile_picture TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Tabela zadań
  db.prepare(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT,
      status TEXT,
      list_id TEXT,
      list_name TEXT,
      folder_id TEXT,
      folder_name TEXT,
      space_id TEXT,
      space_name TEXT,
      url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Tabela wpisów czasu (time entries) - bez FOREIGN KEY dla prostoty
  db.prepare(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      task_name TEXT,
      user_id TEXT,
      user_name TEXT,
      user_email TEXT,
      start_time DATETIME,
      end_time DATETIME,
      duration INTEGER,
      billable INTEGER DEFAULT 0,
      description TEXT,
      space_name TEXT,
      folder_name TEXT,
      list_name TEXT,
      task_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Indeksy dla szybkich zapytań
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_time_entries_user ON time_entries(user_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_time_entries_start ON time_entries(start_time)`).run();
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_time_entries_end ON time_entries(end_time)`).run();

  // Tabela użytkowników aplikacji (auth)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS app_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'pm', 'user')),
      display_name TEXT,
      clickup_user_id TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    )
  `).run();

  await migrateAppUsersSchema();

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_app_users_username ON app_users(username)`).run();

  // Tabele Notion (cache danych)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS notion_workers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notion_page_id TEXT UNIQUE NOT NULL,
      clickup_user_id TEXT,
      name TEXT NOT NULL,
      hourly_rate REAL DEFAULT 0,
      status TEXT DEFAULT 'Aktywny',
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_notion_workers_clickup ON notion_workers(clickup_user_id)`).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS notion_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notion_page_id TEXT UNIQUE NOT NULL,
      clickup_id TEXT,
      name TEXT NOT NULL,
      hourly_rate REAL DEFAULT 0,
      status TEXT,
      tags TEXT,
      synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  db.prepare(`CREATE INDEX IF NOT EXISTS idx_notion_projects_clickup ON notion_projects(clickup_id)`).run();

  // Migracja: dodanie monthly_budget do notion_projects
  const projectCols = db.prepare(`PRAGMA table_info(notion_projects)`).all() as Array<{ name: string }>;
  if (!projectCols.some((c) => c.name === 'monthly_budget')) {
    db.prepare(`ALTER TABLE notion_projects ADD COLUMN monthly_budget REAL DEFAULT 0`).run();
  }

  // Migracja: dodanie is_internal do notion_projects
  // Projekty wewnętrzne (np. "important") nie generują przychodu — tylko koszty.
  if (!projectCols.some((c) => c.name === 'is_internal')) {
    db.prepare(`ALTER TABLE notion_projects ADD COLUMN is_internal INTEGER DEFAULT 0`).run();
  }

  // Tabela ustawień aplikacji (runtime-changeable config)
  db.prepare(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      is_secret INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  // Seed admin user jeśli nie istnieje
  await seedAdminUser();

  console.log('✅ Baza danych zainicjalizowana');
}

async function seedAdminUser() {
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const existingAdmin = db.prepare('SELECT id FROM app_users WHERE username = ?').get(adminUsername);

  if (!existingAdmin) {
    const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');
    const passwordHash = await hashPassword(adminPassword);

    db.prepare(`
      INSERT INTO app_users (username, password_hash, role, display_name)
      VALUES (?, ?, 'admin', 'Administrator')
    `).run(adminUsername, passwordHash);

    console.log(`\n🔐 Utworzono konto administratora:`);
    console.log(`   Username: ${adminUsername}`);
    if (!process.env.ADMIN_PASSWORD) {
      console.log(`   Password: ${adminPassword}`);
      console.log(`   ⚠️  Zapisz to hasło! Nie zostanie wyświetlone ponownie.`);
      console.log(`   💡 Ustaw ADMIN_PASSWORD w .env dla stałego hasła.\n`);
    }
  }
}

async function migrateAppUsersSchema() {
  const tableInfo = db.prepare(`PRAGMA table_info(app_users)`).all() as Array<{ name: string }>;
  const hasClickupUserId = tableInfo.some((column) => column.name === 'clickup_user_id');

  const tableSqlRow = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='app_users'`).get() as
    | { sql?: string }
    | undefined;
  const tableSql = tableSqlRow?.sql || '';
  const needsRoleUpdate = tableSql.includes("CHECK(role IN ('admin', 'user'))");

  if (!hasClickupUserId && !needsRoleUpdate) {
    db.prepare(`ALTER TABLE app_users ADD COLUMN clickup_user_id TEXT`).run();
    return;
  }

  if (!needsRoleUpdate) {
    return;
  }

  db.prepare(`
    CREATE TABLE IF NOT EXISTS app_users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'pm', 'user')),
      display_name TEXT,
      clickup_user_id TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    )
  `).run();

  if (hasClickupUserId) {
    db.prepare(`
      INSERT INTO app_users_new (
        id, username, password_hash, role, display_name, clickup_user_id, is_active, created_at, last_login
      )
      SELECT
        id, username, password_hash, role, display_name, clickup_user_id, is_active, created_at, last_login
      FROM app_users
    `).run();
  } else {
    db.prepare(`
      INSERT INTO app_users_new (
        id, username, password_hash, role, display_name, clickup_user_id, is_active, created_at, last_login
      )
      SELECT
        id, username, password_hash, role, display_name, NULL as clickup_user_id, is_active, created_at, last_login
      FROM app_users
    `).run();
  }

  db.prepare(`DROP TABLE app_users`).run();
  db.prepare(`ALTER TABLE app_users_new RENAME TO app_users`).run();
}

// Funkcje pomocnicze dla app_users
export function getAppUserByUsername(username: string): AppUser | undefined {
  return db.prepare('SELECT * FROM app_users WHERE username = ?').get(username) as AppUser | undefined;
}

export function getAppUserById(id: number): AppUser | undefined {
  return db.prepare('SELECT * FROM app_users WHERE id = ?').get(id) as AppUser | undefined;
}

export function getAllAppUsers(): AppUserPublic[] {
  return db.prepare(`
    SELECT id, username, role, display_name, clickup_user_id, is_active, created_at, last_login
    FROM app_users
    ORDER BY created_at DESC
  `).all() as AppUserPublic[];
}

export function createAppUser(
  username: string,
  passwordHash: string,
  role: string = 'user',
  displayName?: string,
  clickupUserId?: string | null
): number {
  const result = db.prepare(`
    INSERT INTO app_users (username, password_hash, role, display_name, clickup_user_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(username, passwordHash, role, displayName || null, clickupUserId || null);
  return result.lastInsertRowid as number;
}

export function updateAppUser(
  id: number,
  updates: { display_name?: string; role?: string; is_active?: number; clickup_user_id?: string | null }
) {
  const setClauses: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.display_name !== undefined) {
    setClauses.push('display_name = ?');
    values.push(updates.display_name);
  }
  if (updates.role !== undefined) {
    setClauses.push('role = ?');
    values.push(updates.role);
  }
  if (updates.is_active !== undefined) {
    setClauses.push('is_active = ?');
    values.push(updates.is_active);
  }
  if (updates.clickup_user_id !== undefined) {
    setClauses.push('clickup_user_id = ?');
    values.push(updates.clickup_user_id || null);
  }

  if (setClauses.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE app_users SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
}

export function updateAppUserPassword(id: number, passwordHash: string) {
  db.prepare('UPDATE app_users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}

export function updateLastLogin(id: number) {
  db.prepare('UPDATE app_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(id);
}

// Pomocnicze funkcje
export function upsertUser(user: {
  id: string;
  username?: string;
  email?: string;
  color?: string;
  profilePicture?: string;
}) {
  const stmt = db.prepare(`
    INSERT INTO users (id, username, email, color, profile_picture, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      username = COALESCE(excluded.username, username),
      email = COALESCE(excluded.email, email),
      color = COALESCE(excluded.color, color),
      profile_picture = COALESCE(excluded.profile_picture, profile_picture),
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(user.id, user.username, user.email, user.color, user.profilePicture);
}

// ── app_settings CRUD ────────────────────────────────────────────────
export type AppSetting = {
  key: string;
  value: string;
  description: string | null;
  is_secret: number;
  updated_at: string;
};

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string, description?: string, isSecret?: boolean): void {
  db.prepare(`
    INSERT INTO app_settings (key, value, description, is_secret, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      description = COALESCE(excluded.description, description),
      is_secret = COALESCE(excluded.is_secret, is_secret),
      updated_at = CURRENT_TIMESTAMP
  `).run(key, value, description ?? null, isSecret ? 1 : 0);
}

export function deleteSetting(key: string): void {
  db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
}

export function getAllSettings(): AppSetting[] {
  return db.prepare('SELECT key, value, description, is_secret, updated_at FROM app_settings ORDER BY key').all() as AppSetting[];
}

export function upsertTask(task: {
  id: string;
  name?: string;
  status?: string;
  list?: { id: string; name: string };
  folder?: { id: string; name: string };
  space?: { id: string; name: string };
  url?: string;
}) {
  const stmt = db.prepare(`
    INSERT INTO tasks (id, name, status, list_id, list_name, folder_id, folder_name, space_id, space_name, url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      name = COALESCE(excluded.name, name),
      status = COALESCE(excluded.status, status),
      list_id = COALESCE(excluded.list_id, list_id),
      list_name = COALESCE(excluded.list_name, list_name),
      folder_id = COALESCE(excluded.folder_id, folder_id),
      folder_name = COALESCE(excluded.folder_name, folder_name),
      space_id = COALESCE(excluded.space_id, space_id),
      space_name = COALESCE(excluded.space_name, space_name),
      url = COALESCE(excluded.url, url),
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(
    task.id,
    task.name,
    task.status,
    task.list?.id,
    task.list?.name,
    task.folder?.id,
    task.folder?.name,
    task.space?.id,
    task.space?.name,
    task.url
  );
}
