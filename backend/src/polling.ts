import { db, upsertTask } from './database.js';
import { Server } from 'socket.io';
import { fetchClickUpTask, getClickUpTeamId } from './clickup.js';
import { emitActiveSessions, emitScopedEvent } from './socket.js';
import { MAX_ENTRY_DURATION_MS } from './constants.js';
import { runBackfill } from './backfill.js';

const CLICKUP_API = 'https://api.clickup.com/api/v2';
const POLL_INTERVAL = 30000; // 30 sekund
const BACKFILL_INTERVAL = 3 * 60 * 60 * 1000; // 3h
const BACKFILL_DAYS = 2; // ostatnie 2 dni — z zapasem na strefy czasowe
const TEAM_ID = getClickUpTeamId(); // Team ID (workspace)

interface RunningTimer {
  id: string;
  task: {
    id: string;
    name: string;
    url: string;
  };
  user: {
    id: number;
    username: string;
    email: string;
    color: string;
    profilePicture: string | null;
  };
  start: string;
  duration: number;
}

interface CachedTimer extends RunningTimer {
  list_name?: string | null;
  folder_name?: string | null;
  space_name?: string | null;
}

interface TimeEntryResponse {
  data: RunningTimer | null;
}

let activeTimers: Map<string, CachedTimer> = new Map();

async function fetchRunningTimer(): Promise<RunningTimer | null> {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) {
    console.warn('⚠️ Brak CLICKUP_API_TOKEN - polling wyłączony');
    return null;
  }

  try {
    const res = await fetch(`${CLICKUP_API}/team/${TEAM_ID}/time_entries/current`, {
      headers: { Authorization: token },
    });

    if (!res.ok) {
      console.error('❌ Błąd API:', res.status, await res.text());
      return null;
    }

    const data: TimeEntryResponse = await res.json();
    return data.data;
  } catch (error) {
    console.error('❌ Błąd fetch:', error);
    return null;
  }
}

async function fetchAllRunningTimers(): Promise<RunningTimer[]> {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) {
    console.log('[POLL] Brak tokena');
    return [];
  }

  const members = await fetchTeamMembers();
  console.log(`[POLL] Sprawdzam ${members.length} członków zespołu`);
  const runningTimers: RunningTimer[] = [];

  for (const member of members) {
    try {
      const url = `${CLICKUP_API}/team/${TEAM_ID}/time_entries/current?assignee=${member.id}`;
      const res = await fetch(url, { headers: { Authorization: token } });

      if (res.ok) {
        const data: TimeEntryResponse = await res.json();
        console.log(`[POLL] ${member.username}: ${data.data ? `timer (duration: ${data.data.duration})` : 'brak'}`);
        if (data.data) {
          runningTimers.push(data.data);
        }
      } else {
        console.log(`[POLL] ${member.username}: błąd ${res.status}`);
      }
    } catch (e) {
      console.log(`[POLL] ${member.username}: exception`);
    }
  }

  return runningTimers;
}

async function fetchTeamMembers(): Promise<Array<{ id: number; username: string }>> {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) return [];

  try {
    const res = await fetch(`${CLICKUP_API}/team`, {
      headers: { Authorization: token },
    });

    if (!res.ok) return [];

    const data = await res.json();
    const team = data.teams?.find((t: any) => t.id === TEAM_ID);
    if (!team) return [];

    return team.members.map((m: any) => ({
      id: m.user.id,
      username: m.user.username,
    }));
  } catch (e) {
    return [];
  }
}

function parseStartTime(startTime: string): number {
  let parsed = new Date(startTime).getTime();
  if (Number.isFinite(parsed)) return parsed;

  if (!startTime.includes('Z') && !startTime.includes('+')) {
    const isoLike = startTime.replace(' ', 'T') + 'Z';
    parsed = new Date(isoLike).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }

  console.warn(`⚠️ [POLL] Nie można sparsować daty: ${startTime}`);
  return Date.now();
}

function syncCacheFromDatabase() {
  const activeInDb = db
    .prepare(
      `SELECT id, task_id, task_name, task_url, user_id, user_name, user_email,
              start_time, list_name, folder_name, space_name
       FROM time_entries WHERE end_time IS NULL`
    )
    .all() as Array<{
    id: string;
    task_id: string;
    task_name: string;
    task_url: string;
    user_id: string;
    user_name: string;
    user_email: string;
    start_time: string;
    list_name: string | null;
    folder_name: string | null;
    space_name: string | null;
  }>;

  for (const entry of activeInDb) {
    const startMs = parseStartTime(entry.start_time);
    console.log(`📥 [POLL] Cache: ${entry.user_name} - start_time=${entry.start_time} -> ${startMs}ms`);

    activeTimers.set(entry.id, {
      id: entry.id,
      task: {
        id: entry.task_id,
        name: entry.task_name,
        url: entry.task_url,
      },
      user: {
        id: parseInt(entry.user_id) || 0,
        username: entry.user_name,
        email: entry.user_email,
        color: '',
        profilePicture: null,
      },
      start: String(startMs),
      duration: -1,
      list_name: entry.list_name,
      folder_name: entry.folder_name,
      space_name: entry.space_name,
    });
  }

  console.log(`📥 [POLL] Załadowano ${activeInDb.length} aktywnych timerów z bazy`);
}

export function startPolling(io: Server) {
  console.log('🔄 Polling aktywnych timerów uruchomiony (co 30s)');

  syncCacheFromDatabase();

  // Auto-hide users nieaktywnych w ClickUp team (np. byli pracownicy)
  const syncHiddenUsers = async () => {
    const members = await fetchTeamMembers();
    if (!members.length) return;
    const activeIds = members.map((m) => String(m.id));
    const placeholders = activeIds.map(() => '?').join(',');
    db.prepare(`UPDATE users SET hidden = 0 WHERE id IN (${placeholders})`).run(...activeIds);
    db.prepare(`UPDATE users SET hidden = 1 WHERE id NOT IN (${placeholders})`).run(...activeIds);
  };

  const poll = async () => {
    try { await syncHiddenUsers(); } catch (e: any) { console.warn('[POLL] syncHiddenUsers error:', e?.message); }
    const timers = await fetchAllRunningTimers();
    const currentIds = new Set(timers.map((t) => t.id));
    const previousIds = new Set(activeTimers.keys());

    for (const timer of timers) {
      if (!previousIds.has(timer.id)) {
        console.log(`▶️ [POLL] ${timer.user.username} zaczął: ${timer.task.name}`);

        const startTime = new Date(parseInt(timer.start)).toISOString();
        const taskDetails = await fetchClickUpTask(timer.task.id);
        const taskName = taskDetails?.name || timer.task.name;
        const taskUrl = taskDetails?.url || timer.task.url || `https://app.clickup.com/t/${timer.task.id}`;
        const listName = taskDetails?.list?.name || null;
        const folderName = taskDetails?.folder?.name || null;
        const spaceName = taskDetails?.space?.name || null;

        upsertTask({
          id: timer.task.id,
          name: taskName,
          status: taskDetails?.status,
          list: taskDetails?.list,
          folder: taskDetails?.folder,
          space: taskDetails?.space,
          url: taskUrl,
        });

        const stmt = db.prepare(`
          INSERT INTO time_entries (
            id, task_id, task_name, user_id, user_name, user_email,
            start_time, task_url, list_name, folder_name, space_name
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            start_time = excluded.start_time,
            task_name = excluded.task_name,
            task_url = excluded.task_url,
            list_name = excluded.list_name,
            folder_name = excluded.folder_name,
            space_name = excluded.space_name
        `);

        stmt.run(
          timer.id,
          timer.task.id,
          taskName,
          String(timer.user.id),
          timer.user.username,
          timer.user.email,
          startTime,
          taskUrl,
          listName,
          folderName,
          spaceName
        );

        emitScopedEvent(io, 'time_entry_started', {
          id: timer.id,
          task_id: timer.task.id,
          task_name: taskName,
          task_url: taskUrl,
          user_id: String(timer.user.id),
          user_name: timer.user.username,
          user_email: timer.user.email,
          user_color: timer.user.color,
          user_avatar: timer.user.profilePicture,
          start_time: startTime,
          list_name: listName,
          folder_name: folderName,
          space_name: spaceName,
        });

        activeTimers.set(timer.id, {
          ...timer,
          list_name: listName,
          folder_name: folderName,
          space_name: spaceName,
        });
      } else {
        const existing = activeTimers.get(timer.id);
        if (existing) {
          activeTimers.set(timer.id, { ...existing, ...timer });
        } else {
          activeTimers.set(timer.id, timer);
        }
      }
    }

    for (const [id, timer] of activeTimers) {
      if (!currentIds.has(id)) {
        activeTimers.delete(id);

        const endTime = new Date().toISOString();
        let startMs = Number.parseInt(timer.start, 10);

        console.log(`⏹️ [POLL] ${timer.user.username} skończył: ${timer.task.name}`);
        console.log(`   timer.start=${timer.start}, startMs=${startMs}, isFinite=${Number.isFinite(startMs)}`);

        if (!Number.isFinite(startMs)) {
          const dbEntry = db.prepare('SELECT start_time FROM time_entries WHERE id = ?').get(id) as { start_time: string } | undefined;
          if (dbEntry?.start_time) {
            startMs = parseStartTime(dbEntry.start_time);
            console.log(`   Fallback: DB start_time=${dbEntry.start_time} -> ${startMs}ms`);
          }
        }

        let durationMs = Number.isFinite(startMs) ? Math.max(0, Date.now() - startMs) : 0;
        if (durationMs > MAX_ENTRY_DURATION_MS) {
          console.log(`   ⚠️ Duration ${Math.round(durationMs / 3600000)}h > max ${MAX_ENTRY_DURATION_MS / 3600000}h — capping`);
          durationMs = MAX_ENTRY_DURATION_MS;
        }
        console.log(`   Duration: ${Math.round(durationMs / 1000 / 60)}min (${durationMs}ms)`);

        db.prepare(`
          UPDATE time_entries
          SET end_time = ?, duration = ?
          WHERE id = ? AND (end_time IS NULL OR end_time = '')
        `).run(endTime, durationMs, timer.id);

        emitScopedEvent(io, 'time_entry_stopped', {
          id: timer.id,
          task_id: timer.task.id,
          task_name: timer.task.name,
          user_id: String(timer.user.id),
          user_name: timer.user.username,
          user_color: timer.user.color,
          end_time: endTime,
          list_name: timer.list_name,
          folder_name: timer.folder_name,
          space_name: timer.space_name,
        });
      }
    }

    const activeSessions = timers.map((t) => {
      const cached = activeTimers.get(t.id);
      const taskUrl = t.task.url || cached?.task?.url || `https://app.clickup.com/t/${t.task.id}`;
      return {
        id: t.id,
        task_id: t.task.id,
        task_name: t.task.name,
        task_url: taskUrl,
        user_id: String(t.user.id),
        user_name: t.user.username,
        user_email: t.user.email,
        user_color: t.user.color,
        user_avatar: t.user.profilePicture,
        start_time: new Date(parseInt(t.start)).toISOString(),
        list_name: cached?.list_name || null,
        folder_name: cached?.folder_name || null,
        space_name: cached?.space_name || null,
      };
    });

    emitActiveSessions(io, activeSessions);
  };

  poll();
  setInterval(poll, POLL_INTERVAL);

  // Backfill z ClickUp co 3h (naprawia ucięte wpisy z polling fallbacka)
  const safeBackfill = () => runBackfill(BACKFILL_DAYS).catch((e: any) => console.warn('🔁 [BACKFILL] error:', e?.message));
  setTimeout(safeBackfill, 60000); // pierwszy run po 1 min od startu
  setInterval(safeBackfill, BACKFILL_INTERVAL);
}
