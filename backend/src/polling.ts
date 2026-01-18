import { db, upsertTask } from './database.js';
import { Server } from 'socket.io';
import { fetchClickUpTask, getClickUpTeamId } from './clickup.js';
import { emitActiveSessions, emitScopedEvent } from './socket.js';

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

export function startPolling(io: Server) {
  console.log('🔄 Polling aktywnych timerów uruchomiony (co 30s)');

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
        const taskUrl = taskDetails?.url || timer.task.url;
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
        console.log(`⏹️ [POLL] ${timer.user.username} skończył: ${timer.task.name}`);
        activeTimers.delete(id);

        // Webhook powinien zaktualizować bazę, więc tylko emitujemy
        emitScopedEvent(io, 'time_entry_stopped', {
          id: timer.id,
          task_id: timer.task.id,
          task_name: timer.task.name,
          user_id: String(timer.user.id),
          user_name: timer.user.username,
          user_color: timer.user.color,
          end_time: new Date().toISOString(),
          list_name: timer.list_name,
          folder_name: timer.folder_name,
          space_name: timer.space_name,
        });
      }
    }

    // Wyślij aktualną listę aktywnych sesji do wszystkich klientów (z cache, który ma list info)
    const activeSessions = timers.map((t) => {
      const cached = activeTimers.get(t.id);
      return {
        id: t.id,
        task_id: t.task.id,
        task_name: t.task.name,
        task_url: t.task.url,
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
