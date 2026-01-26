import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

const API_URL = import.meta.env.VITE_API_URL || '';

type RangePreset = 'today' | 'week' | 'month' | 'last_month' | 'custom';

function getPresetDates(preset: RangePreset): { start: string; end: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (preset) {
    case 'today': {
      const end = new Date(today);
      end.setDate(end.getDate() + 1);
      return {
        start: today.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
      };
    }
    case 'week': {
      const dayOfWeek = today.getDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(today);
      monday.setDate(today.getDate() - diff);
      const nextMonday = new Date(monday);
      nextMonday.setDate(monday.getDate() + 7);
      return {
        start: monday.toISOString().split('T')[0],
        end: nextMonday.toISOString().split('T')[0],
      };
    }
    case 'month': {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      return {
        start: firstDay.toISOString().split('T')[0],
        end: lastDay.toISOString().split('T')[0],
      };
    }
    case 'last_month': {
      const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth(), 1);
      return {
        start: firstDay.toISOString().split('T')[0],
        end: lastDay.toISOString().split('T')[0],
      };
    }
    default:
      return { start: '', end: '' };
  }
}

const PRESET_LABELS: Record<RangePreset, string> = {
  today: 'Dzisiaj',
  week: 'Ten tydzień',
  month: 'Ten miesiąc',
  last_month: 'Poprzedni miesiąc',
  custom: 'Własny zakres',
};

const IMPORT_STEPS = [
  'Pobieram listę członków zespołu...',
  'Pobieram wpisy z ClickUp API...',
  'Pobieram szczegóły zadań...',
  'Zapisuję do bazy danych...',
];

export function TimeEntriesImport({
  token,
  onImported,
}: {
  token: string;
  onImported: () => void;
}) {
  const [isImporting, setIsImporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState<RangePreset>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Elapsed timer + step rotation during import
  useEffect(() => {
    if (isImporting) {
      setElapsed(0);
      setStepIndex(0);
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        const sec = Math.floor((Date.now() - startTime) / 1000);
        setElapsed(sec);
        // Rotate steps every 4 seconds (cycle through available steps)
        setStepIndex(Math.floor(sec / 4) % IMPORT_STEPS.length);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isImporting]);

  const { start, end } = useMemo(() => {
    if (preset === 'custom') {
      return { start: customStart, end: customEnd };
    }
    return getPresetDates(preset);
  }, [preset, customStart, customEnd]);

  const rangeLabel = useMemo(() => {
    if (!start || !end) return '';
    const startDate = new Date(start);
    const endDate = new Date(end);
    endDate.setDate(endDate.getDate() - 1); // end is exclusive

    const formatDate = (d: Date) => d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });

    if (start === end) return formatDate(startDate);
    return `${formatDate(startDate)} - ${formatDate(endDate)}`;
  }, [start, end]);

  const canImport = start && end && new Date(start) <= new Date(end);

  const handleImport = async () => {
    if (!canImport) return;

    setIsImporting(true);
    setError(null);
    setStatus(null);

    try {
      const url = `${API_URL}/api/earnings/import-time-entries?start=${start}&end=${end}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.details || 'Błąd importu historii');
      }

      const data = await response.json();
      setStatus(
        `Zapisano ${data.saved} z ${data.fetched} wpisów (pominięto: ${data.skipped}, członków: ${data.assignees}).`
      );
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd importu historii');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Card className="bg-card">
      <CardContent className="p-4 bg-card">
      <div className="text-sm font-medium text-foreground mb-3">Import historii time trackingu</div>

      {/* Preset buttons */}
      <div className="flex flex-wrap gap-2 mb-3">
        {(Object.keys(PRESET_LABELS) as RangePreset[]).map((p) => (
          <Button
            key={p}
            onClick={() => setPreset(p)}
            type="button"
            size="sm"
            variant="outline"
            className={`px-3 ${
              preset === p
                ? 'bg-[var(--active-surface)] text-foreground border-[var(--active-border)] hover:bg-[var(--active-surface)]'
                : 'bg-card text-muted-foreground border-border hover:bg-muted/60 hover:text-foreground'
            }`}
          >
            {PRESET_LABELS[p]}
          </Button>
        ))}
      </div>

      {/* Custom date inputs */}
      {preset === 'custom' && (
        <div className="flex flex-wrap gap-3 mb-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Od</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Do</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
        </div>
      )}

      {/* Import button + progress */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {rangeLabel && `Zakres: ${rangeLabel}`}
        </div>
        <Button
          onClick={handleImport}
          disabled={isImporting || !canImport}
          className="bg-[var(--active-surface)] text-foreground hover:bg-[var(--active-surface)]"
        >
          {isImporting ? 'Importuję...' : 'Importuj'}
        </Button>
      </div>

      {/* Import progress */}
      {isImporting && (
        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <svg className="animate-spin h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>{IMPORT_STEPS[stepIndex]}</span>
          <span className="font-mono text-xs ml-auto">{elapsed}s</span>
        </div>
      )}

      {status && <div className="mt-3 text-sm text-emerald-400">{status}</div>}
      {error && <div className="mt-3 text-sm text-destructive">{error}</div>}
    </CardContent>
    </Card>
  );
}
