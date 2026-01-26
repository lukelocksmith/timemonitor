import { useEffect, useState, useRef } from 'react';
import { Routes, Route, Navigate, Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from './contexts/AuthContext';
import { Login } from './components/Login';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminPanel } from './components/AdminPanel';
import { EarningsTab } from './components/EarningsTab';
import { HomeTab } from './components/HomeTab';
import { TimeEntriesImport } from './components/TimeEntriesImport';
import { DateRangePicker, DateRange, buildDateQueryParams } from './components/DateRangePicker';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Avatar } from './components/Avatar';

type ThemeMode = 'dark' | 'light';
const THEME_STORAGE_KEY = 'ui-theme';

interface TimeEntry {
  id: string;
  task_id: string;
  task_name: string;
  task_url?: string;
  user_id: string;
  user_name: string;
  user_email?: string;
  user_color?: string;
  user_avatar?: string;
  start_time: string;
  end_time?: string;
  duration?: number;
  list_name?: string;
  folder_name?: string;
  space_name?: string;
}

interface User {
  id: string;
  username: string;
  email?: string;
  color?: string;
  profile_picture?: string;
  total_duration: number;
  entries_count: number;
  unique_tasks: number;
}

interface TeamStats {
  period: string;
  users: User[];
  totals: {
    total_duration: number;
    total_entries: number;
    active_users: number;
  };
}

const API_URL = import.meta.env.VITE_API_URL || '';

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function formatDurationLong(ms: number): string {
  if (!ms || ms <= 0) return '0 s.';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours} g. ${minutes} m. ${seconds} s.`;
  }
  if (minutes > 0) {
    return `${minutes} m. ${seconds} s.`;
  }
  return `${seconds} s.`;
}

function formatDurationParts(ms?: number): { hours?: string; minutes?: string; seconds: string } {
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

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('pl-PL', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function getTaskUrl(entry: TimeEntry): string | null {
  if (entry.task_url) return entry.task_url;
  if (entry.task_id) {
    return `https://app.clickup.com/t/${entry.task_id}`;
  }
  return null;
}

function SunIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <line x1="4.2" y1="4.2" x2="6.3" y2="6.3" />
      <line x1="17.7" y1="17.7" x2="19.8" y2="19.8" />
      <line x1="4.2" y1="19.8" x2="6.3" y2="17.7" />
      <line x1="17.7" y1="6.3" x2="19.8" y2="4.2" />
    </svg>
  );
}

function MoonIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.6A8 8 0 1 1 11.4 3a6.5 6.5 0 0 0 9.6 9.6z" />
    </svg>
  );
}

function stripListPrefix(taskName: string, listName?: string): string {
  if (!listName) return taskName;

  const trimmedTaskName = taskName.trim();
  const prefix = `[${listName}]`;

  if (trimmedTaskName.toLowerCase().startsWith(prefix.toLowerCase())) {
    return trimmedTaskName.slice(prefix.length).trim();
  }

  return taskName;
}

function getElapsedTime(startTime: string): number {
  return Date.now() - new Date(startTime).getTime();
}

type HistoryRange = 'last_30_days' | 'this_year' | 'last_year' | 'all';

function getHistoryRangeDates(range: HistoryRange): { start: string; end: string } | null {
  const now = new Date();

  switch (range) {
    case 'last_30_days': {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return { start: start.toISOString(), end: now.toISOString() };
    }
    case 'this_year': {
      const start = new Date(now.getFullYear(), 0, 1);
      const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    case 'last_year': {
      const start = new Date(now.getFullYear() - 1, 0, 1);
      const end = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    default:
      return null;
  }
}

const historyRangeLabels: Record<HistoryRange, string> = {
  last_30_days: 'Ostatnie 30 dni',
  this_year: 'Bieżący rok',
  last_year: 'Poprzedni rok',
  all: 'Wszystko',
};

function ActiveSession({ entry }: { entry: TimeEntry }) {
  const [elapsed, setElapsed] = useState(getElapsedTime(entry.start_time));
  const taskUrl = getTaskUrl(entry);
  const taskLabel = stripListPrefix(entry.task_name, entry.list_name);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(getElapsedTime(entry.start_time));
    }, 1000);
    return () => clearInterval(interval);
  }, [entry.start_time]);

  return (
    <Card className="active-pulse slide-in">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <Avatar name={entry.user_name} color={entry.user_color} avatar={entry.user_avatar} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-foreground">{entry.user_name}</span>
              <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">
                <span className="w-2 h-2 bg-emerald-500 rounded-full mr-1 animate-pulse"></span>
                Aktywny
              </Badge>
              {entry.list_name && (
                <Badge
                  variant="outline"
                  className="border-[var(--active-border)] bg-[var(--active-surface)] text-muted-foreground"
                >
                  {entry.list_name}
                </Badge>
              )}
            </div>
            {taskUrl ? (
            <a
                href={taskUrl}
              target="_blank"
              rel="noopener noreferrer"
            className="text-primary hover:underline font-medium truncate block mt-1"
            >
                {taskLabel}
            </a>
            ) : (
              <span className="text-primary font-medium truncate block mt-1">
                {taskLabel}
              </span>
            )}
          </div>
          <div className="text-right">
            <div className="text-2xl font-mono font-bold text-foreground">
              {formatDuration(elapsed)}
            </div>
            <div className="text-xs text-muted-foreground">od {formatTime(entry.start_time)}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function HistoryEntry({ entry }: { entry: TimeEntry }) {
  const taskLabel = stripListPrefix(entry.task_name, entry.list_name);
  const taskUrl = getTaskUrl(entry);
  const durationParts = formatDurationParts(entry.duration);
  const entryDate = formatDate(entry.start_time);

  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <Avatar name={entry.user_name} color={entry.user_color} avatar={entry.user_avatar} size="sm" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{entry.user_name}</span>
              {entry.list_name && (
                <Badge
                  variant="outline"
                  className="border-[var(--active-border)] bg-[var(--active-surface)] text-muted-foreground"
                >
                  {entry.list_name}
                </Badge>
              )}
            </div>
            {taskUrl ? (
            <a
                href={taskUrl}
              target="_blank"
              rel="noopener noreferrer"
            className="text-primary hover:underline text-sm truncate block"
            >
                {taskLabel}
            </a>
            ) : (
              <span className="text-primary text-sm truncate block">
                {taskLabel}
              </span>
            )}
          </div>
          <div className="text-right text-sm">
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
            <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
              <span>
              {formatTime(entry.start_time)} - {entry.end_time ? formatTime(entry.end_time) : '?'}
              </span>
              <span className="text-muted-foreground/60">•</span>
              <span>{entryDate}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Komponent zakładki Live
function LiveTab({
  activeSessions,
  history,
  users,
  selectedUser,
  setSelectedUser,
  token,
  isAdmin,
  canFilterHistory,
  isImportOpen,
  onHistoryImported,
  historyRange,
  setHistoryRange,
  historyLimit,
  setHistoryLimit,
}: {
  activeSessions: TimeEntry[];
  history: TimeEntry[];
  users: User[];
  selectedUser: string | null;
  setSelectedUser: (id: string | null) => void;
  token: string | null;
  isAdmin: boolean;
  canFilterHistory: boolean;
  isImportOpen: boolean;
  onHistoryImported: () => void;
  historyRange: HistoryRange;
  setHistoryRange: (range: HistoryRange) => void;
  historyLimit: number;
  setHistoryLimit: (value: number) => void;
}) {
  const filteredActive = activeSessions;

  const filteredHistory = selectedUser
    ? history.filter((e) => e.user_id === selectedUser)
    : history;

  useEffect(() => {
    if (!canFilterHistory && selectedUser) {
      setSelectedUser(null);
    }
  }, [canFilterHistory, selectedUser, setSelectedUser]);

  return (
    <>
      {isAdmin && token && isImportOpen && (
        <div className="mb-6">
          <TimeEntriesImport
            token={token}
            onImported={onHistoryImported}
          />
        </div>
      )}

      {/* Aktywne sesje */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
          Aktualnie pracują ({filteredActive.length})
        </h2>

        {filteredActive.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <p className="text-lg text-foreground">Nikt aktualnie nie pracuje</p>
              <p className="text-sm mt-2">
                Kiedy ktoś włączy time tracking w ClickUp, pojawi się tutaj
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {filteredActive.map((entry) => (
              <ActiveSession key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>

      {/* Historia */}
      <section>
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-foreground">Historia time trackingu</h2>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {canFilterHistory && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">Filtruj historię:</span>
                <select
                  value={selectedUser || ''}
                  onChange={(e) => setSelectedUser(e.target.value || null)}
                  className="w-full sm:w-56 h-9 px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring bg-background text-foreground text-sm font-medium"
                >
                  <option value="">Wszyscy</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.username}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex w-full flex-wrap items-center justify-start gap-2 sm:ml-auto sm:w-auto sm:justify-end">
            {Object.entries(historyRangeLabels).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setHistoryRange(key as HistoryRange)}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  historyRange === key
                    ? 'bg-[var(--active-surface)] text-foreground border border-[var(--active-border)]'
                    : 'bg-card text-muted-foreground border border-border hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
            <select
              value={historyLimit}
              onChange={(e) => setHistoryLimit(parseInt(e.target.value, 10))}
              className="h-9 px-3 py-2 rounded-md text-sm font-medium border border-border bg-background text-foreground"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
            </div>
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">
              <p>Brak historii</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-2">
            {filteredHistory.map((entry) => (
              <HistoryEntry key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

// Komponent zakładki Statystyki
function StatsTab() {
  const { token } = useAuth();
  const [dateRange, setDateRange] = useState<DateRange>({ start: '', end: '', period: 'today' });
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !dateRange.start || !dateRange.end) return;
    setLoading(true);
    const queryParams = buildDateQueryParams(dateRange);
    fetch(`${API_URL}/api/stats/team?${queryParams}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [dateRange, token]);

  return (
    <div>
      {/* Wybór okresu */}
      <div className="mb-6">
        <DateRangePicker onChange={setDateRange} initialPeriod="today" />
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Ładowanie...</div>
      ) : stats ? (
        <>
          {/* Podsumowanie */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <Card>
              <CardContent className="p-6">
                <div className="text-3xl font-semibold text-highlight-2">
                  {formatDurationLong(stats.totals.total_duration)}
                </div>
                <div className="text-sm text-muted-foreground mt-1">Łączny czas</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-3xl font-semibold text-highlight-1">
                  {stats.totals.active_users}
                </div>
                <div className="text-sm text-muted-foreground mt-1">Aktywnych osób</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-3xl font-semibold text-highlight-3">
                  {stats.totals.total_entries}
                </div>
                <div className="text-sm text-muted-foreground mt-1">Wpisów czasu</div>
              </CardContent>
            </Card>
          </div>

          {/* Tabela użytkowników */}
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-border">
              <CardTitle className="text-lg text-foreground">
                Statystyki per osoba
              </CardTitle>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Osoba
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Czas
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Wpisy
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Zadania
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-card divide-y divide-border">
                  {stats.users.map((user) => (
                    <tr key={user.id} className={user.total_duration > 0 ? '' : 'opacity-50'}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-3">
                          <Avatar
                            name={user.username}
                            color={user.color}
                            avatar={user.profile_picture}
                            size="sm"
                          />
                          <div>
                            <div className="font-medium text-foreground">{user.username}</div>
                            {user.email && (
                              <div className="text-sm text-muted-foreground">{user.email}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className={`font-mono font-semibold ${user.total_duration > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                          {formatDurationLong(user.total_duration)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-muted-foreground">
                        {user.entries_count}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-muted-foreground">
                        {user.unique_tasks}
                      </td>
                    </tr>
                  ))}
                  {stats.users.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                        Brak danych dla wybranego okresu
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <div className="text-center py-8 text-muted-foreground">Brak danych</div>
      )}
    </div>
  );
}

type DashboardProps = {
  theme: ThemeMode;
  onToggleTheme: () => void;
};

// Dashboard component - główna strona z aktywnością
function Dashboard({ theme, onToggleTheme }: DashboardProps) {
  const { token, logout, user, isAdmin, isPm } = useAuth();
  const [connected, setConnected] = useState(false);
  const [activeSessions, setActiveSessions] = useState<TimeEntry[]>([]);
  const [history, setHistory] = useState<TimeEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'home' | 'live' | 'stats' | 'earnings'>('home');
  const [historyRange, setHistoryRange] = useState<HistoryRange>('last_30_days');
  const [historyLimit, setHistoryLimit] = useState<number>(50);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isNotionSyncOpen, setIsNotionSyncOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const canFilterHistory = isAdmin || isPm;

  const getTabButtonClasses = (isActive: boolean) => {
    const baseClasses = 'px-4 py-1.5 text-sm font-medium rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

    if (isActive) {
      return `${baseClasses} bg-[var(--active-surface)] text-foreground border border-[var(--active-border)]`;
    }

    return `${baseClasses} bg-transparent text-muted-foreground border border-transparent hover:text-foreground hover:bg-muted/60`;
  };

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (activeTab !== 'live') {
      setIsImportOpen(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'earnings') {
      setIsNotionSyncOpen(false);
    }
  }, [activeTab]);

  // Socket.io connection - separate effect to avoid reconnections
  useEffect(() => {
    if (!token) return;

    // Połącz z Socket.io z autoryzacją
    const newSocket = io(API_URL || window.location.origin, {
      auth: { token },
    });

    newSocket.on('connect', () => {
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      setConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error.message);
      if (error.message.includes('token')) {
        logout();
      }
    });

    // Początkowe dane
    newSocket.on('active_sessions', (sessions: TimeEntry[]) => {
      setActiveSessions(sessions);
    });

    // Nowa sesja
    newSocket.on('time_entry_started', (entry: TimeEntry) => {
      setActiveSessions((prev) => [entry, ...prev.filter((e) => e.id !== entry.id)]);
    });

    // Zakończona sesja
    newSocket.on('time_entry_stopped', (data: Partial<TimeEntry>) => {
      setActiveSessions((prev) => prev.filter((e) => e.id !== data.id));
      setHistory((prev) => {
        const existing = prev.find((e) => e.id === data.id);
        if (existing) {
          return prev.map((e) => (e.id === data.id ? { ...e, ...data } : e));
        }
        return [data as TimeEntry, ...prev].slice(0, 50);
      });
    });

    // Aktualizacja sesji
    newSocket.on('time_entry_updated', (data: Partial<TimeEntry>) => {
      setActiveSessions((prev) =>
        prev.map((e) => (e.id === data.id ? { ...e, ...data } : e))
      );
    });

    return () => {
      newSocket.close();
    };
  }, [token, logout]);

  // Fetch history and users - separate effect for data loading
  useEffect(() => {
    if (!token) return;

    const range = getHistoryRangeDates(historyRange);
    const params = new URLSearchParams({
      limit: String(historyLimit),
    });
    if (range) {
      params.set('start', range.start);
      params.set('end', range.end);
    }

    fetch(`${API_URL}/api/history?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
      .then((res) => res.json())
      .then((data) => setHistory(data.entries || []))
      .catch(console.error);

    if (canFilterHistory) {
      fetch(`${API_URL}/api/stats/team?period=month`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
        .then((res) => res.json())
        .then((data) => setUsers(data.users || []))
        .catch(console.error);
    } else {
      setUsers([]);
    }
  }, [token, historyRange, historyLimit, canFilterHistory]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="bg-card/80 backdrop-blur border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                ClickUp Activity Monitor
              </h1>
              <p className="text-sm text-muted-foreground">Kto teraz nad czym pracuje</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span
                  className={`w-3 h-3 rounded-full ${
                    connected ? 'bg-green-500' : 'bg-red-500'
                  }`}
                ></span>
                <span className="text-sm text-muted-foreground">
                  {connected ? 'Połączono' : 'Rozłączono'}
                </span>
              </div>
              <div className="flex items-center gap-3 pl-4 border-l border-border relative" ref={userMenuRef}>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => setUserMenuOpen((prev) => !prev)}
                  className="gap-2"
                >
                  <span>{user?.display_name || user?.username}</span>
                  <svg
                    className="h-4 w-4 text-muted-foreground"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <line x1="4" y1="6" x2="20" y2="6" />
                    <line x1="4" y1="12" x2="20" y2="12" />
                    <line x1="4" y1="18" x2="20" y2="18" />
                  </svg>
                </Button>

                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-40 rounded-md border border-border bg-[var(--menu-bg)] z-[2]">
                    <button
                      onClick={() => {
                        onToggleTheme();
                        setUserMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground bg-[var(--menu-bg)] hover:bg-muted"
                    >
                      {theme === 'dark' ? (
                        <SunIcon className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <MoonIcon className="h-4 w-4 text-muted-foreground" />
                      )}
                      {theme === 'dark' ? 'Tryb jasny' : 'Tryb ciemny'}
                    </button>
                    {isAdmin && (
                      <Link
                        to="/admin"
                        onClick={() => setUserMenuOpen(false)}
                        className="block w-full px-3 py-2 text-sm text-foreground bg-[var(--menu-bg)] hover:bg-muted"
                      >
                        Panel
                      </Link>
                    )}
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        logout();
                      }}
                      className="block w-full text-left px-3 py-2 text-sm text-destructive bg-[var(--menu-bg)] hover:bg-muted"
                    >
                      Wyloguj
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Zakładki */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex gap-1 rounded-full bg-muted/60 p-1 border border-border">
            <button
              onClick={() => setActiveTab('home')}
                className={getTabButtonClasses(activeTab === 'home')}
            >
              Home
            </button>
            <button
              onClick={() => setActiveTab('live')}
                className={getTabButtonClasses(activeTab === 'live')}
            >
              Live Activity
            </button>
            <button
              onClick={() => setActiveTab('stats')}
                className={getTabButtonClasses(activeTab === 'stats')}
            >
              Statystyki
            </button>
            <button
              onClick={() => setActiveTab('earnings')}
                className={getTabButtonClasses(activeTab === 'earnings')}
            >
              Zarobki
            </button>
            </div>
            {isAdmin && token && activeTab === 'live' && (
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setIsImportOpen((prev) => !prev)}
                className="relative z-0"
              >
                {isImportOpen ? 'Ukryj import' : 'Importuj historię'}
              </Button>
            )}
            {isAdmin && token && activeTab === 'earnings' && (
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={() => setIsNotionSyncOpen((prev) => !prev)}
                className="relative z-0"
              >
                {isNotionSyncOpen ? 'Ukryj synchronizację' : 'Synchronizacja z Notion'}
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {activeTab === 'home' ? (
          <HomeTab />
        ) : activeTab === 'live' ? (
          <LiveTab
            activeSessions={activeSessions}
            history={history}
            users={users}
            selectedUser={selectedUser}
            setSelectedUser={setSelectedUser}
            token={token}
            isAdmin={isAdmin}
            canFilterHistory={canFilterHistory}
            isImportOpen={isImportOpen}
            onHistoryImported={() => {
              if (!token) return;
              const range = getHistoryRangeDates(historyRange);
              const params = new URLSearchParams({
                limit: String(historyLimit),
              });
              if (range) {
                params.set('start', range.start);
                params.set('end', range.end);
              }

              fetch(`${API_URL}/api/history?${params.toString()}`, {
                headers: { 'Authorization': `Bearer ${token}` },
              })
                .then((res) => res.json())
                .then((data) => setHistory(data.entries || []))
                .catch(console.error);

              if (canFilterHistory) {
                fetch(`${API_URL}/api/stats/team?period=month`, {
                  headers: { 'Authorization': `Bearer ${token}` },
                })
                  .then((res) => res.json())
                  .then((data) => setUsers(data.users || []))
                  .catch(console.error);
              } else {
                setUsers([]);
              }
            }}
            historyRange={historyRange}
            setHistoryRange={setHistoryRange}
            historyLimit={historyLimit}
            setHistoryLimit={setHistoryLimit}
          />
        ) : activeTab === 'stats' ? (
          <StatsTab />
        ) : (
          <EarningsTab showNotionSync={isAdmin && isNotionSyncOpen} />
        )}
      </main>

      {/* Footer */}
      <footer className="text-center py-4 text-sm text-muted-foreground">
        ClickUp Activity Monitor v1.0
      </footer>
    </div>
  );
}

type AdminPageProps = {
  theme: ThemeMode;
  onToggleTheme: () => void;
};

// Admin wrapper component
function AdminPage({ theme, onToggleTheme }: AdminPageProps) {
  const { logout, user } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="bg-card/80 backdrop-blur border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">
                ClickUp Activity Monitor
              </h1>
              <p className="text-sm text-muted-foreground">Panel administratora</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {user?.display_name || user?.username}
                <span className="ml-1 text-xs text-purple-600">(admin)</span>
              </span>
              <Link
                to="/"
                className="text-sm text-foreground/80 hover:text-foreground"
              >
                Dashboard
              </Link>
              <button
                onClick={onToggleTheme}
                className="inline-flex items-center gap-2 text-sm text-foreground/80 hover:text-foreground"
              >
                {theme === 'dark' ? (
                  <SunIcon className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <MoonIcon className="h-4 w-4 text-muted-foreground" />
                )}
                {theme === 'dark' ? 'Tryb jasny' : 'Tryb ciemny'}
              </button>
              <button
                onClick={logout}
                className="text-sm text-red-500 hover:text-red-600"
              >
                Wyloguj
              </button>
            </div>
          </div>
        </div>
      </header>

      <AdminPanel />
    </div>
  );
}

function App() {
  const { isAuthenticated, isLoading } = useAuth();
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') {
      return 'dark';
    }
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-lg">Ładowanie...</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <Login />}
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard theme={theme} onToggleTheme={handleToggleTheme} />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute requireAdmin>
            <AdminPage theme={theme} onToggleTheme={handleToggleTheme} />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
