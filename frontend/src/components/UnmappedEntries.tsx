import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { DateRange, buildDateQueryParams } from './DateRangePicker';
import { Button } from './ui/button';

const API_URL = import.meta.env.VITE_API_URL || '';

type UnmappedEntry = {
  id: string;
  task_id: string;
  task_name: string;
  user_id: string;
  user_name: string;
  start_time: string;
  end_time: string;
  list_id: string | null;
  list_name: string | null;
  space_name: string | null;
  folder_name: string | null;
  reason: 'missing_task' | 'missing_list_id' | 'missing_project' | 'missing_worker';
};

type UnmappedResponse = {
  total: number;
  entries: UnmappedEntry[];
};

const REASON_LABELS: Record<string, { label: string; description: string; color: string }> = {
  missing_task: {
    label: 'Brak zadania',
    description: 'Zadanie nie istnieje w bazie tasks',
    color: 'bg-red-100 text-red-800',
  },
  missing_list_id: {
    label: 'Brak list_id',
    description: 'Zadanie nie ma przypisanej listy ClickUp',
    color: 'bg-orange-100 text-orange-800',
  },
  missing_project: {
    label: 'Brak projektu',
    description: 'Lista ClickUp nie jest zmapowana w Notion Projects',
    color: 'bg-yellow-100 text-yellow-800',
  },
  missing_worker: {
    label: 'Brak pracownika',
    description: 'Użytkownik nie jest zmapowany w Notion Workers',
    color: 'bg-purple-100 text-purple-800',
  },
};

interface UnmappedEntriesProps {
  dateRange: DateRange;
  unmappedCount: number;
}

export function UnmappedEntries({ dateRange, unmappedCount }: UnmappedEntriesProps) {
  const { token } = useAuth();
  const [entries, setEntries] = useState<UnmappedEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<'reason' | 'user' | 'project'>('reason');

  useEffect(() => {
    if (!token || !dateRange.start || !dateRange.end) return;

    const fetchUnmapped = async () => {
      setLoading(true);
      setError(null);
      try {
        const queryParams = buildDateQueryParams(dateRange);
        const res = await fetch(`${API_URL}/api/earnings/unmapped?${queryParams}&limit=500`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Błąd pobierania niezmapowanych wpisów');
        const data = (await res.json()) as UnmappedResponse;
        setEntries(data.entries);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Błąd');
      } finally {
        setLoading(false);
      }
    };

    fetchUnmapped();
  }, [dateRange, token]);

  if (unmappedCount === 0) return null;

  const groupedByReason = entries.reduce(
    (acc, entry) => {
      const key = entry.reason;
      if (!acc[key]) acc[key] = [];
      acc[key].push(entry);
      return acc;
    },
    {} as Record<string, UnmappedEntry[]>
  );

  const groupedByUser = entries.reduce(
    (acc, entry) => {
      const key = `${entry.user_id}|${entry.user_name}`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(entry);
      return acc;
    },
    {} as Record<string, UnmappedEntry[]>
  );

  const groupedByProject = entries.reduce(
    (acc, entry) => {
      const key = entry.list_id ? `${entry.list_id}|${entry.list_name || 'Nieznana lista'}` : 'null|Brak listy';
      if (!acc[key]) acc[key] = [];
      acc[key].push(entry);
      return acc;
    },
    {} as Record<string, UnmappedEntry[]>
  );

  const formatDuration = (start: string, end: string) => {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  };

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="bg-card rounded-2xl border border-destructive/30 px-6 py-4">
      <div className="mb-4">
        <h3 className="font-semibold text-foreground">Niezmapowane wpisy</h3>
        <p className="text-sm text-muted-foreground">
          {unmappedCount} {unmappedCount === 1 ? 'wpis wymaga' : 'wpisów wymaga'} uzupełnienia danych
        </p>
      </div>
      {loading ? (
        <div className="text-center py-4 text-muted-foreground">Ładowanie...</div>
      ) : error ? (
        <div className="text-center py-4 text-destructive">{error}</div>
      ) : (
        <>
          {/* Group by selector */}
          <div className="flex gap-2 mb-4">
            <span className="text-sm text-muted-foreground py-1">Grupuj według:</span>
            {(['reason', 'user', 'project'] as const).map((g) => (
              <Button
                key={g}
                onClick={() => setGroupBy(g)}
                type="button"
                size="sm"
                variant="outline"
                className={`${
                  groupBy === g
                    ? 'bg-[var(--active-surface)] text-foreground border-[var(--active-border)] hover:bg-[var(--active-surface)]'
                    : 'bg-card text-muted-foreground border-border hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                {g === 'reason' ? 'Przyczyna' : g === 'user' ? 'Pracownik' : 'Projekt'}
              </Button>
            ))}
          </div>

          {/* Grouped entries */}
          <div className="space-y-4 max-h-[500px] overflow-y-auto">
            {groupBy === 'reason' &&
              Object.entries(groupedByReason).map(([reason, items]) => (
                <ReasonGroup key={reason} reason={reason} entries={items} formatDate={formatDate} formatDuration={formatDuration} />
              ))}

            {groupBy === 'user' &&
              Object.entries(groupedByUser)
                .sort((a, b) => b[1].length - a[1].length)
                .map(([key, items]) => {
                  const [userId, userName] = key.split('|');
                  return (
                    <UserGroup
                      key={key}
                      userId={userId}
                      userName={userName}
                      entries={items}
                      formatDate={formatDate}
                      formatDuration={formatDuration}
                    />
                  );
                })}

            {groupBy === 'project' &&
              Object.entries(groupedByProject)
                .sort((a, b) => b[1].length - a[1].length)
                .map(([key, items]) => {
                  const [listId, listName] = key.split('|');
                  return (
                    <ProjectGroup
                      key={key}
                      listId={listId === 'null' ? null : listId}
                      listName={listName}
                      entries={items}
                      formatDate={formatDate}
                      formatDuration={formatDuration}
                    />
                  );
                })}
          </div>

          {/* Summary by reason */}
          <div className="mt-4 pt-4 border-t border-border">
            <h4 className="text-sm font-medium text-muted-foreground mb-2">Podsumowanie przyczyn:</h4>
            <div className="flex flex-wrap gap-2">
              {Object.entries(groupedByReason).map(([reason, items]) => (
                <span
                  key={reason}
                  className={`px-3 py-1 rounded-full text-xs font-medium ${REASON_LABELS[reason]?.color || 'bg-muted'}`}
                >
                  {REASON_LABELS[reason]?.label || reason}: {items.length}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ReasonGroup({
  reason,
  entries,
  formatDate,
  formatDuration,
}: {
  reason: string;
  entries: UnmappedEntry[];
  formatDate: (iso: string) => string;
  formatDuration: (start: string, end: string) => string;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const info = REASON_LABELS[reason] || { label: reason, description: '', color: 'bg-muted' };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between bg-muted hover:bg-muted/80"
      >
        <div className="flex items-center gap-3">
          <span className={`px-2 py-1 rounded text-xs font-medium ${info.color}`}>{info.label}</span>
          <span className="text-sm text-muted-foreground">{info.description}</span>
        </div>
        <span className="text-sm font-medium">{entries.length} wpisów</span>
      </button>
      {isOpen && (
        <div className="divide-y divide-border">
          {entries.slice(0, 20).map((entry) => (
            <EntryRow key={entry.id} entry={entry} formatDate={formatDate} formatDuration={formatDuration} showReason={false} />
          ))}
          {entries.length > 20 && (
            <div className="px-4 py-2 text-sm text-muted-foreground text-center">
              ...i {entries.length - 20} więcej
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UserGroup({
  userId,
  userName,
  entries,
  formatDate,
  formatDuration,
}: {
  userId: string;
  userName: string;
  entries: UnmappedEntry[];
  formatDate: (iso: string) => string;
  formatDuration: (start: string, end: string) => string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between bg-muted hover:bg-muted/80"
      >
        <div className="flex items-center gap-3">
          <span className="font-medium">{userName}</span>
          <span className="text-xs text-muted-foreground">ID: {userId}</span>
        </div>
        <span className="text-sm font-medium">{entries.length} wpisów</span>
      </button>
      {isOpen && (
        <div className="divide-y divide-border">
          {entries.slice(0, 20).map((entry) => (
            <EntryRow key={entry.id} entry={entry} formatDate={formatDate} formatDuration={formatDuration} showReason={true} />
          ))}
          {entries.length > 20 && (
            <div className="px-4 py-2 text-sm text-muted-foreground text-center">
              ...i {entries.length - 20} więcej
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectGroup({
  listId,
  listName,
  entries,
  formatDate,
  formatDuration,
}: {
  listId: string | null;
  listName: string;
  entries: UnmappedEntry[];
  formatDate: (iso: string) => string;
  formatDuration: (start: string, end: string) => string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between bg-muted hover:bg-muted/80"
      >
        <div className="flex items-center gap-3">
          <span className="font-medium">{listName}</span>
          {listId && <span className="text-xs text-muted-foreground">ID: {listId}</span>}
        </div>
        <span className="text-sm font-medium">{entries.length} wpisów</span>
      </button>
      {isOpen && (
        <div className="divide-y divide-border">
          {entries.slice(0, 20).map((entry) => (
            <EntryRow key={entry.id} entry={entry} formatDate={formatDate} formatDuration={formatDuration} showReason={true} />
          ))}
          {entries.length > 20 && (
            <div className="px-4 py-2 text-sm text-muted-foreground text-center">
              ...i {entries.length - 20} więcej
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  formatDate,
  formatDuration,
  showReason,
}: {
  entry: UnmappedEntry;
  formatDate: (iso: string) => string;
  formatDuration: (start: string, end: string) => string;
  showReason: boolean;
}) {
  const info = REASON_LABELS[entry.reason];

  return (
    <div className="px-4 py-2 text-sm hover:bg-muted">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{entry.task_name}</div>
          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 mt-1">
            <span>{entry.user_name}</span>
            {entry.list_name && <span>{entry.list_name}</span>}
            {entry.space_name && <span className="text-muted-foreground">{entry.space_name}</span>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-xs text-muted-foreground">{formatDate(entry.start_time)}</div>
          <div className="font-medium">{formatDuration(entry.start_time, entry.end_time)}</div>
          {showReason && (
            <span className={`inline-block mt-1 px-2 py-0.5 rounded text-xs ${info?.color || 'bg-muted'}`}>
              {info?.label || entry.reason}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
