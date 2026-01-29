import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { DateRangePicker, DateRange, buildDateQueryParams } from './DateRangePicker';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Avatar } from './Avatar';

const API_URL = import.meta.env.VITE_API_URL || '';

interface TaskUser {
  user_id: string;
  user_name: string;
  user_color: string | null;
  user_avatar: string | null;
}

interface HomeSummaryTask {
  task_id: string;
  task_name: string;
  task_url: string | null;
  list_name: string | null;
  total_duration: number;
  hours_worked: number;
  entries_count: number;
  first_start_time: string | null;
  users: TaskUser[];
}

interface HomeSummaryResponse {
  period: string;
  start: string;
  end: string;
  totals: {
    total_hours: number;
    total_duration: number;
    total_earnings: number;
    hourly_rate: number | null;
    tasks_count: number;
    entries_count: number;
  };
  tasks: HomeSummaryTask[];
}

interface TaskEntry {
  id: string;
  start_time: string;
  end_time: string;
  duration: number;
  description: string | null;
  user_id: string;
  user_name: string;
  user_color: string | null;
  user_avatar: string | null;
}

function formatDurationCompact(ms: number): string {
  if (!ms || ms <= 0) return '0 g. 0 m.';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours} g. ${minutes} m.`;
}

function formatDurationParts(ms: number): { hours?: string; minutes?: string; seconds: string } {
  if (!ms || ms <= 0) return { seconds: '0s' };
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return {
    hours: hours > 0 ? `${hours}h` : undefined,
    minutes: minutes > 0 || hours > 0 ? `${minutes}m` : undefined,
    seconds: `${seconds}s`,
  };
}

function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
  });
}

function formatEntryTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return '—';
  const s = new Date(start);
  const e = new Date(end);
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return '—';

  const sameDay = s.toDateString() === e.toDateString();
  const startTime = formatTime(start);
  const endTime = formatTime(end);

  if (sameDay) {
    return `${startTime}\u2013${endTime}`;
  }
  return `${startTime} \u2013 ${formatDate(end)} ${endTime}`;
}

function stripListPrefix(taskName: string, listName?: string | null): string {
  if (!listName) return taskName;
  const trimmed = taskName.trim();
  const prefix = `[${listName}]`;
  if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
    return trimmed.slice(prefix.length).trim();
  }
  return taskName;
}

export function HomeTab() {
  const { token, isAdmin } = useAuth();
  const [dateRange, setDateRange] = useState<DateRange>({ start: '', end: '', period: 'today' });
  const [data, setData] = useState<HomeSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expandable entries state
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [taskEntries, setTaskEntries] = useState<TaskEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);

  useEffect(() => {
    if (!token || !dateRange.start || !dateRange.end) return;
    setLoading(true);
    setError(null);
    setExpandedTaskId(null);
    setTaskEntries([]);

    const queryParams = buildDateQueryParams(dateRange);

    fetch(`${API_URL}/api/home/summary?${queryParams}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Blad pobierania danych');
        return res.json();
      })
      .then((json: HomeSummaryResponse) => {
        setData(json);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Blad');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [dateRange, token]);

  const toggleExpand = async (task: HomeSummaryTask) => {
    if (expandedTaskId === task.task_id) {
      setExpandedTaskId(null);
      setTaskEntries([]);
      return;
    }

    setExpandedTaskId(task.task_id);
    setEntriesLoading(true);

    try {
      const queryParams = buildDateQueryParams(dateRange);
      const res = await fetch(
        `${API_URL}/api/home/task-entries?task_id=${task.task_id}&${queryParams}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error('Blad');
      const json = await res.json();
      setTaskEntries(json.entries || []);
    } catch {
      setTaskEntries([]);
    } finally {
      setEntriesLoading(false);
    }
  };

  return (
    <div>
      {/* Date range picker */}
      <div className="mb-6">
        <DateRangePicker onChange={setDateRange} initialPeriod="today" />
      </div>

      {error && (
        <Card className="mb-6">
          <CardContent className="p-6 text-center text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Ladowanie...</div>
      ) : data ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <Card>
              <CardContent className="p-6">
                <div className="text-3xl font-semibold text-highlight-2">
                  {formatDurationCompact(data.totals.total_duration)}
                </div>
                <div className="text-sm text-muted-foreground mt-1">Godziny pracy</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-3xl font-semibold text-highlight-1">
                  {data.totals.total_earnings > 0
                    ? `${data.totals.total_earnings.toFixed(2)} PLN`
                    : '\u2014'}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  {isAdmin ? 'Koszt zespolu' : 'Zarobek'}
                  {data.totals.hourly_rate ? ` (${data.totals.hourly_rate} PLN/h)` : ''}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-3xl font-semibold text-highlight-3">
                  {data.totals.tasks_count}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Zadania ({data.totals.entries_count} wpisow)
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Task list */}
          <div className="space-y-2">
            <div className="text-sm font-medium text-muted-foreground mb-2">
              Zadania ({data.tasks.length})
            </div>
            {data.tasks.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  Brak zadan w wybranym okresie
                </CardContent>
              </Card>
            ) : (
              data.tasks.map((task) => {
                const isExpanded = expandedTaskId === task.task_id;
                const hasMultiple = task.entries_count > 1;
                const taskLabel = stripListPrefix(task.task_name, task.list_name);
                const durationParts = formatDurationParts(task.total_duration);
                const firstUser = task.users?.[0];
                const extraUsers = (task.users?.length || 0) - 1;

                return (
                  <Card key={task.task_id}>
                    <CardContent className="p-3">
                      <div
                        className={`flex items-center gap-3${hasMultiple ? ' cursor-pointer' : ''}`}
                        onClick={hasMultiple ? () => toggleExpand(task) : undefined}
                      >
                        {/* Avatar(s) */}
                        <div className="shrink-0">
                          {firstUser ? (
                            extraUsers > 0 ? (
                              /* Stacked avatars for multi-user */
                              <div className="relative w-10 h-8">
                                <div className="absolute top-0 left-0">
                                  <Avatar
                                    name={firstUser.user_name}
                                    color={firstUser.user_color || undefined}
                                    avatar={firstUser.user_avatar || undefined}
                                    size="sm"
                                  />
                                </div>
                                <div className="absolute top-0 left-5 w-5 h-8 flex items-center">
                                  <span className="text-xs text-muted-foreground font-medium">
                                    +{extraUsers}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <Avatar
                                name={firstUser.user_name}
                                color={firstUser.user_color || undefined}
                                avatar={firstUser.user_avatar || undefined}
                                size="sm"
                              />
                            )
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground text-xs">
                              ?
                            </div>
                          )}
                        </div>

                        {/* Task info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">
                              {firstUser?.user_name || 'Nieznany'}
                            </span>
                            {task.list_name && (
                              <Badge
                                variant="outline"
                                className="border-[var(--active-border)] bg-[var(--active-surface)] text-muted-foreground shrink-0"
                              >
                                {task.list_name}
                              </Badge>
                            )}
                            {hasMultiple && (
                              <Badge
                                variant="outline"
                                className="border-border text-muted-foreground shrink-0"
                              >
                                {task.entries_count}x
                              </Badge>
                            )}
                          </div>
                          {task.task_url ? (
                            <a
                              href={task.task_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-primary hover:underline text-sm truncate block"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {taskLabel}
                            </a>
                          ) : (
                            <span className="text-primary text-sm truncate block">
                              {taskLabel}
                            </span>
                          )}
                        </div>

                        {/* Duration + date */}
                        <div className="text-right text-sm shrink-0">
                          <div className="flex items-baseline justify-end gap-1">
                            {durationParts.hours && (
                              <span className="font-mono text-base font-semibold text-foreground">
                                {durationParts.hours}
                              </span>
                            )}
                            {durationParts.minutes && (
                              <span className="font-mono text-base font-semibold text-foreground">
                                {durationParts.minutes}
                              </span>
                            )}
                            <span className="font-mono text-base font-semibold text-foreground">
                              {durationParts.seconds}
                            </span>
                          </div>
                          {/* Date only for single-entry tasks */}
                          {!hasMultiple && task.first_start_time && (
                            <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                              <span>{formatTime(task.first_start_time)}</span>
                              <span className="text-muted-foreground/60">&bull;</span>
                              <span>{formatDate(task.first_start_time)}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Expanded entries list */}
                      {isExpanded && (
                        <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                          {entriesLoading ? (
                            <div className="text-sm text-muted-foreground py-1 pl-11">
                              Ladowanie wpisow...
                            </div>
                          ) : taskEntries.length === 0 ? (
                            <div className="text-sm text-muted-foreground py-1 pl-11">
                              Brak wpisow
                            </div>
                          ) : (
                            taskEntries.map((entry) => {
                              const entryParts = formatDurationParts(entry.duration);
                              return (
                                <div
                                  key={entry.id}
                                  className="flex items-center gap-3 pl-3 py-1.5"
                                >
                                  <Avatar
                                    name={entry.user_name}
                                    color={entry.user_color || undefined}
                                    avatar={entry.user_avatar || undefined}
                                    size="sm"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium text-foreground">
                                      {entry.user_name}
                                    </span>
                                    {entry.description && (
                                      <span className="text-sm text-muted-foreground block truncate">
                                        {entry.description}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-right text-sm shrink-0">
                                    <div className="flex items-baseline justify-end gap-1">
                                      {entryParts.hours && (
                                        <span className="font-mono text-base font-semibold text-foreground">
                                          {entryParts.hours}
                                        </span>
                                      )}
                                      {entryParts.minutes && (
                                        <span className="font-mono text-base font-semibold text-foreground">
                                          {entryParts.minutes}
                                        </span>
                                      )}
                                      <span className="font-mono text-base font-semibold text-foreground">
                                        {entryParts.seconds}
                                      </span>
                                    </div>
                                    <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                                      <span>
                                        {formatEntryTimeRange(entry.start_time, entry.end_time)}
                                      </span>
                                      <span className="text-muted-foreground/60">&bull;</span>
                                      <span>{formatDate(entry.start_time)}</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </>
      ) : (
        <div className="text-center py-8 text-muted-foreground">Brak danych</div>
      )}
    </div>
  );
}
