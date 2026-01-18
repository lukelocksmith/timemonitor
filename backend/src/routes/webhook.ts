import { Router, Request, Response } from 'express';
import { db, upsertUser, upsertTask } from '../database.js';
import { fetchClickUpTask } from '../clickup.js';
import { emitScopedEvent } from '../socket.js';

export const webhookRouter = Router();

// Typy dla ClickUp webhook payload (taskTimeTrackedUpdated)
interface HistoryItem {
  id: string;
  type: number;
  date: string;
  field: string;
  parent_id: string;
  data: {
    total_time?: string;
    rollup_time?: string;
  };
  user: {
    id: number;
    username: string;
    email: string;
    color: string;
    initials: string;
    profilePicture: string | null;
  };
  before: {
    id: string;
    start: string;
    end: string;
    time: string;
  } | null;
  after: {
    id: string;
    start: string;
    end: string;
    time: string;
    source?: string;
    date_added?: string;
  } | null;
}

interface ClickUpWebhookPayload {
  event: string;
  webhook_id: string;
  task_id: string;
  team_id: string;
  history_items?: HistoryItem[];
  data?: {
    description?: string;
    interval_id?: string;
  };
}

// Pobierz szczegóły zadania z ClickUp i zapisz w bazie
async function fetchAndStoreTask(taskId: string) {
  const task = await fetchClickUpTask(taskId);

  const taskData = {
    id: taskId,
    name: task?.name || `Zadanie ${taskId}`,
    status: task?.status,
    list: task?.list,
    folder: task?.folder,
    space: task?.space,
    url: task?.url || `https://app.clickup.com/t/${taskId}`,
  };

  upsertTask(taskData);
  return taskData;
}

// Główny endpoint webhook
webhookRouter.post('/clickup', async (req: Request, res: Response) => {
  const io = req.app.locals.io;
  const payload: ClickUpWebhookPayload = req.body;

  console.log(`📥 Webhook event: ${payload.event}`);

  try {
    if (payload.event === 'taskTimeTrackedUpdated') {
      await handleTimeTrackedUpdated(payload, io);
    } else {
      console.log(`ℹ️ Nieobsługiwany event: ${payload.event}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Błąd przetwarzania webhooka:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

async function handleTimeTrackedUpdated(payload: ClickUpWebhookPayload, io: any) {
  const historyItem = payload.history_items?.[0];
  if (!historyItem) {
    console.log('⚠️ Brak history_items');
    return;
  }

  const user = historyItem.user;
  const timeEntry = historyItem.after;
  const prevEntry = historyItem.before;

  // Zapisz użytkownika
  upsertUser({
    id: String(user.id),
    username: user.username,
    email: user.email,
    color: user.color,
    profilePicture: user.profilePicture || undefined,
  });

  // Pobierz szczegóły zadania
  const task = await fetchAndStoreTask(payload.task_id);
  const taskName = task.name;
  const taskUrl = task.url || `https://app.clickup.com/t/${payload.task_id}`;
  const listName = task.list?.name || null;
  const folderName = task.folder?.name || null;
  const spaceName = task.space?.name || null;

  // Nowy time entry (start trackingu)
  if (timeEntry && !prevEntry) {
    const startTime = new Date(parseInt(timeEntry.start)).toISOString();
    const hasEnd = timeEntry.end && timeEntry.end !== timeEntry.start;
    const endTime = hasEnd ? new Date(parseInt(timeEntry.end)).toISOString() : null;
    const duration = parseInt(timeEntry.time) || 0;

    console.log(`▶️ ${user.username} ${hasEnd ? 'zalogował' : 'zaczął'}: ${taskName}`);

    // Zapisz do bazy
    const stmt = db.prepare(`
      INSERT INTO time_entries (
        id, task_id, task_name, user_id, user_name, user_email,
        start_time, end_time, duration, task_url, list_name, folder_name, space_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        duration = excluded.duration,
        task_name = excluded.task_name,
        task_url = excluded.task_url,
        list_name = excluded.list_name,
        folder_name = excluded.folder_name,
        space_name = excluded.space_name
    `);

    stmt.run(
      timeEntry.id,
      payload.task_id,
      taskName,
      String(user.id),
      user.username,
      user.email,
      startTime,
      endTime,
      duration,
      taskUrl,
      listName,
      folderName,
      spaceName
    );

    if (hasEnd) {
      // Zakończony wpis - do historii
      emitScopedEvent(io, 'time_entry_stopped', {
        id: timeEntry.id,
        task_id: payload.task_id,
        task_name: taskName,
        task_url: taskUrl,
        user_id: String(user.id),
        user_name: user.username,
        user_color: user.color,
        user_avatar: user.profilePicture,
        start_time: startTime,
        end_time: endTime,
        duration: duration,
        list_name: listName,
        folder_name: folderName,
        space_name: spaceName,
      });
    } else {
      // Aktywny tracking
      emitScopedEvent(io, 'time_entry_started', {
        id: timeEntry.id,
        task_id: payload.task_id,
        task_name: taskName,
        task_url: taskUrl,
        user_id: String(user.id),
        user_name: user.username,
        user_email: user.email,
        user_color: user.color,
        user_avatar: user.profilePicture,
        start_time: startTime,
        list_name: listName,
        folder_name: folderName,
        space_name: spaceName,
      });
    }
  }

  // Aktualizacja time entry (stop lub edycja)
  if (timeEntry && prevEntry) {
    const startTime = new Date(parseInt(timeEntry.start)).toISOString();
    const endTime = timeEntry.end ? new Date(parseInt(timeEntry.end)).toISOString() : null;
    const duration = parseInt(timeEntry.time) || 0;

    // Czy to stop? (poprzednio nie było end, teraz jest)
    const wasRunning = !prevEntry.end || prevEntry.end === prevEntry.start;
    const isNowStopped = timeEntry.end && timeEntry.end !== timeEntry.start;

    if (wasRunning && isNowStopped) {
      console.log(`⏹️ ${user.username} skończył: ${taskName} (${Math.round(duration / 1000 / 60)}min)`);
    } else {
      console.log(`✏️ ${user.username} zaktualizował: ${taskName}`);
    }

    // Aktualizuj w bazie
    const stmt = db.prepare(`
      UPDATE time_entries
      SET start_time = ?, end_time = ?, duration = ?, task_name = ?, task_url = ?, list_name = ?, folder_name = ?, space_name = ?
      WHERE id = ?
    `);

    stmt.run(startTime, endTime, duration, taskName, taskUrl, listName, folderName, spaceName, timeEntry.id);

    if (wasRunning && isNowStopped) {
      emitScopedEvent(io, 'time_entry_stopped', {
        id: timeEntry.id,
        task_id: payload.task_id,
        task_name: taskName,
        task_url: taskUrl,
        user_id: String(user.id),
        user_name: user.username,
        user_color: user.color,
        end_time: endTime,
        duration: duration,
        list_name: listName,
        folder_name: folderName,
        space_name: spaceName,
      });
    } else {
      emitScopedEvent(io, 'time_entry_updated', {
        id: timeEntry.id,
        task_id: payload.task_id,
        task_name: taskName,
        user_id: String(user.id),
        user_name: user.username,
        start_time: startTime,
        end_time: endTime,
        duration: duration,
        list_name: listName,
        folder_name: folderName,
        space_name: spaceName,
      });
    }
  }
}
