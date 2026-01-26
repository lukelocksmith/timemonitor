import { getConfig } from './config.js';

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2';
const DEFAULT_TEAM_ID = '4552118';

export function getClickUpTeamId(): string {
  return getConfig('CLICKUP_TEAM_ID', DEFAULT_TEAM_ID)!;
}

function getClickUpToken(): string | null {
  return getConfig('CLICKUP_API_TOKEN') || null;
}

export type ClickUpTaskDetails = {
  id: string;
  name: string;
  status?: string;
  list?: { id: string; name: string };
  folder?: { id: string; name: string };
  space?: { id: string; name: string };
  url?: string;
};

export async function fetchClickUpTask(taskId: string): Promise<ClickUpTaskDetails | null> {
  const token = getClickUpToken();
  if (!token) {
    return null;
  }

  try {
    const response = await fetch(`${CLICKUP_API_BASE}/task/${taskId}`, {
      headers: { Authorization: token },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    return {
      id: data.id || taskId,
      name: data.name || `Zadanie ${taskId}`,
      status: data.status?.status || data.status?.name,
      list: data.list ? { id: data.list.id, name: data.list.name } : undefined,
      folder: data.folder ? { id: data.folder.id, name: data.folder.name } : undefined,
      space: data.space ? { id: data.space.id, name: data.space.name } : undefined,
      url: data.url || `https://app.clickup.com/t/${taskId}`,
    };
  } catch (error) {
    console.error('Błąd pobierania taska z ClickUp:', error);
    return null;
  }
}

type ClickUpTimeEntry = {
  id?: string;
  task?: { id?: string; name?: string; url?: string };
  task_id?: string;
  user?: { id?: number; username?: string; email?: string; color?: string; profilePicture?: string | null };
  user_id?: number | string;
  start?: number | string;
  end?: number | string;
  duration?: number | string;
  billable?: boolean;
  description?: string;
};

export async function fetchClickUpTimeEntries(params: {
  teamId: string;
  startMs: number;
  endMs: number;
  page: number;
  limit: number;
  assignee?: string;
  includeLocationNames?: boolean;
}): Promise<ClickUpTimeEntry[]> {
  const token = getClickUpToken();
  if (!token) {
    throw new Error('Brak CLICKUP_API_TOKEN w .env');
  }

  const searchParams = new URLSearchParams({
    start_date: String(params.startMs),
    end_date: String(params.endMs),
    page: String(params.page),
    limit: String(params.limit),
  });

  if (params.assignee) {
    searchParams.set('assignee', params.assignee);
  }

  if (params.includeLocationNames) {
    searchParams.set('include_location_names', 'true');
  }

  const response = await fetch(
    `${CLICKUP_API_BASE}/team/${params.teamId}/time_entries?${searchParams.toString()}`,
    { headers: { Authorization: token } }
  );

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`ClickUp API error ${response.status}: ${bodyText}`);
  }

  try {
    const data = JSON.parse(bodyText);
    if (Array.isArray(data?.data)) {
      return data.data as ClickUpTimeEntry[];
    }
    if (Array.isArray(data)) {
      return data as ClickUpTimeEntry[];
    }
    return [];
  } catch {
    return [];
  }
}

export async function fetchClickUpTeamMembers(teamId: string): Promise<Array<{
  id: number;
  username: string;
  email?: string;
  color?: string;
  profilePicture?: string | null;
}>> {
  const token = getClickUpToken();
  if (!token) {
    throw new Error('Brak CLICKUP_API_TOKEN w .env');
  }

  const response = await fetch(`${CLICKUP_API_BASE}/team`, {
    headers: { Authorization: token },
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`ClickUp API error ${response.status}: ${bodyText}`);
  }

  try {
    const data = JSON.parse(bodyText);
    const team = data?.teams?.find((t: any) => String(t.id) === String(teamId));
    if (!team) {
      return [];
    }

    return (team.members || []).map((m: any) => ({
      id: m.user.id,
      username: m.user.username,
      email: m.user.email,
      color: m.user.color,
      profilePicture: m.user.profilePicture || null,
    }));
  } catch {
    return [];
  }
}
