import { db } from './database.js';

const CLICKUP = 'https://api.clickup.com/api/v2';

/**
 * Pobiera time_entries z ClickUp za ostatnie daysBack dni i upsertuje do lokalnej DB.
 * Naprawia wpisy skrócone przez polling fallback. Uruchamiany co 3h przez polling.ts.
 */
export async function runBackfill(daysBack = 1): Promise<{ upserted: number; durationMs: number }> {
  const TOKEN = process.env.CLICKUP_API_TOKEN;
  const TEAM = process.env.CLICKUP_TEAM_ID;

  if (!TOKEN || !TEAM) {
    console.warn('🔁 [BACKFILL] Brak CLICKUP_API_TOKEN/CLICKUP_TEAM_ID — pomijam');
    return { upserted: 0, durationMs: 0 };
  }

  const startedAt = Date.now();
  console.log(`🔁 [BACKFILL] Start (ostatnie ${daysBack} dni)`);

  let teamData: any;
  try {
    const teamRes = await fetch(`${CLICKUP}/team`, { headers: { Authorization: TOKEN } });
    teamData = await teamRes.json();
  } catch (e: any) {
    console.warn(`🔁 [BACKFILL] Błąd /team: ${e?.message}`);
    return { upserted: 0, durationMs: 0 };
  }

  const team = teamData.teams?.find((t: any) => t.id === TEAM);
  if (!team) {
    console.warn('🔁 [BACKFILL] Team nie znaleziony');
    return { upserted: 0, durationMs: 0 };
  }

  const members: Array<{ id: string; username: string; email: string; color: string; profilePicture: string | null }> =
    team.members.map((m: any) => ({
      id: String(m.user.id),
      username: m.user.username,
      email: m.user.email,
      color: m.user.color,
      profilePicture: m.user.profilePicture,
    }));

  const upsertUserStmt = db.prepare(`
    INSERT INTO users (id, username, email, color, profile_picture, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      email = excluded.email,
      color = excluded.color,
      profile_picture = excluded.profile_picture,
      updated_at = CURRENT_TIMESTAMP
  `);
  for (const m of members) {
    upsertUserStmt.run(m.id, m.username, m.email || null, m.color || null, m.profilePicture || null);
  }

  const now = Date.now();
  const startMs = now - daysBack * 24 * 60 * 60 * 1000;

  const upsertEntryStmt = db.prepare(`
    INSERT INTO time_entries (
      id, task_id, task_name, user_id, user_name, user_email,
      start_time, end_time, duration, billable, task_url, list_name, folder_name, space_name
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      task_url = excluded.task_url,
      list_name = excluded.list_name,
      folder_name = excluded.folder_name,
      space_name = excluded.space_name
  `);

  let totalUpserted = 0;
  let totalDurationMs = 0;

  for (const m of members) {
    const url = `${CLICKUP}/team/${TEAM}/time_entries?start_date=${startMs}&end_date=${now}&assignee=${m.id}&include_task_tags=false&include_location_names=true`;
    try {
      const res = await fetch(url, { headers: { Authorization: TOKEN } });
      if (!res.ok) {
        console.warn(`🔁 [BACKFILL] ${m.username}: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const entries: any[] = data.data || [];
      for (const e of entries) {
        const id = e.id;
        const taskId = e.task?.id || null;
        const taskName = e.task?.name || null;
        const userId = String(e.user?.id ?? m.id);
        const userName = e.user?.username || m.username;
        const userEmail = e.user?.email || m.email || null;
        const start = parseInt(e.start);
        const end = e.end ? parseInt(e.end) : null;
        const duration = parseInt(e.duration) || 0;
        if (!Number.isFinite(start)) continue;
        const startISO = new Date(start).toISOString();
        const endISO = end && Number.isFinite(end) ? new Date(end).toISOString() : null;
        const billable = e.billable ? 1 : 0;
        const taskUrl = e.task_url || (taskId ? `https://app.clickup.com/t/${taskId}` : null);
        const loc = e.task_location || {};
        const listName = loc.list_name || null;
        const folderName = loc.folder_name || null;
        const spaceName = loc.space_name || null;
        upsertEntryStmt.run(
          id, taskId, taskName, userId, userName, userEmail,
          startISO, endISO, duration, billable, taskUrl,
          listName, folderName, spaceName,
        );
        totalUpserted++;
        totalDurationMs += duration;
      }
    } catch (e: any) {
      console.warn(`🔁 [BACKFILL] ${m.username}: błąd ${e?.message}`);
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(`✅ [BACKFILL] Koniec — ${totalUpserted} wpisów, ${Math.round(totalDurationMs / 60000)} min, czas: ${elapsedMs}ms`);
  return { upserted: totalUpserted, durationMs: totalDurationMs };
}
