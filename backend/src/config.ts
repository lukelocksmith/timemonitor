import { getSetting } from './database.js';

/**
 * Centralna funkcja konfiguracji z hierarchią:
 *   1. Wartość z DB (app_settings) — ustawiona przez admin panel
 *   2. Wartość z process.env (.env file)
 *   3. defaultValue (hardcoded fallback)
 */
export function getConfig(key: string, defaultValue?: string): string | null {
  return getSetting(key) ?? process.env[key] ?? defaultValue ?? null;
}
