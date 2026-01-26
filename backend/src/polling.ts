import { db, upsertTask } from './database.js';
import { Server } from 'socket.io';
import { fetchClickUpTask, getClickUpTeamId } from './clickup.js';
import { emitActiveSessions, emitScopedEvent } from './socket.js';
import { MAX_ENTRY_DURATION_MS } from './constants.js';

const CLICKUP_API = 'https://api.clickup.com/api/v2';
const POLL_INTERVAL = 30000; // 30 sekund
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
  duration: number; // ujemny = timer aktywny
}

// Rozszerzony timer z info o projekcie (do cache)
interface CachedTimer extends RunningTimer {
  list_name?: string | null;
  folder_name?: string | null;
  space_name?: string | null;
}

interface TimeEntryResponse {
  data: RunningTimer | null;
}

// Cache aktywnych sesji żeby wykrywać zmiany (z info o projekcie)
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

// Pobierz aktywne timery dla wszystkich członków zespołu
async function fetchAllRunningTimers(): Promise<RunningTimer[]> {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) {
    console.log('[POLL] Brak tokena');
    return [];
  }

  // Pobierz listę członków zespołu
  const members = await fetchTeamMembers();
  console.log(`[POLL] Sprawdzam ${members.length} członków zespołu`);
  const runningTimers: RunningTimer[] = [];

  // Odpytaj każdego członka
  for (const member of members) {
    try {
      const url = `${CLICKUP_API}/team/${TEAM_ID}/time_entries/current?assignee=${member.id}`;
      const res = await fetch(url, { headers: { Authorization: token } });

      if (res.ok) {
        const data: TimeEntryResponse = await res.json();
        console.log(`[POLL] ${member.username}: ${data.data ? `timer (duration: ${data.data.duration})` : 'brak'}`);
        if (data.data && data.data.duration < 0) {
          // Ujemny duration = timer aktywny
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

// Helper: parse date string to milliseconds (handles various formats)
function parseStartTime(startTime: string): number {
  // Try ISO format first
  let parsed = new Date(startTime).getTime();
  if (Number.isFinite(parsed)) return parsed;

  // Try adding 'Z' for UTC if missing timezone
  if (!startTime.includes('Z') && !startTime.includes('+')) {
    // Replace space with 'T' if needed
    const isoLike = startTime.replace(' ', 'T') + 'Z';
    parsed = new Date(isoLike).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }

  console.warn(`⚠️ [POLL] Nie można sparsować daty: ${startTime}`);
  return Date.now(); // Fallback to now (will result in 0 duration)
}

// Sync cache with database on startup (recover from restart)
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

    // Convert DB entry to CachedTimer format
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
      duration: -1, // Active timer
      list_name: entry.list_name,
      folder_name: entry.folder_name,
      space_name: entry.space_name,
    });
  }

  console.log(`📥 [POLL] Załadowano ${activeInDb.length} aktywnych timerów z bazy`);
}

export function startPolling(io: Server) {
  console.log('🔄 Polling aktywnych timerów uruchomiony (co 30s)');

  // Sync cache from database first (recover from restart)
  syncCacheFromDatabase();

  const poll = async () => {
    const timers = await fetchAllRunningTimers();
    const currentIds = new Set(timers.map((t) => t.id));
    const previousIds = new Set(activeTimers.keys());

    // Nowe aktywne timery
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

        // Zapisz do bazy
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

        // Emituj do klientów
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

        // Zapisz do cache z info o projekcie
        activeTimers.set(timer.id, {
          ...timer,
          list_name: listName,
          folder_name: folderName,
          space_name: spaceName,
        });
      } else {
        // Timer już istniał - zaktualizuj cache (może mieć już list info)
        const existing = activeTimers.get(timer.id);
        if (existing) {
          activeTimers.set(timer.id, { ...existing, ...timer });
        } else {
          activeTimers.set(timer.id, timer);
        }
      }
    }

    // Timery które się zakończyły (były aktywne, teraz nie ma)
    for (const [id, timer] of activeTimers) {
      if (!currentIds.has(id)) {
        activeTimers.delete(id);

        // Fallback: jeśli webhook nie zadziałał, uzupełnij end_time i duration
        const endTime = new Date().toISOString();
        let startMs = Number.parseInt(timer.start, 10);

        // Debug: log the values
        console.log(`⏹️ [POLL] ${timer.user.username} skończył: ${timer.task.name}`);
        console.log(`   timer.start=${timer.start}, startMs=${startMs}, isFinite=${Number.isFinite(startMs)}`);

        // If start is invalid, try to parse from DB
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

        // Webhook powinien zaktualizować bazę, więc tylko emitujemy
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

    // Wyślij aktualną listę aktywnych sesji do wszystkich klientów (z cache, który ma list info)
    const activeSessions = timers.map((t) => {
      const cached = activeTimers.get(t.id);
      // Prioritize: API url > cached url > generated url
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

  // Pierwsze odpytanie od razu
  poll();

  // Potem co 30 sekund
  setInterval(poll, POLL_INTERVAL);
}
