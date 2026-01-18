import { useMemo, useState, useEffect } from 'react';
import { Button } from './ui/button';

export type PeriodPreset = 'today' | 'week' | 'month' | 'last_month' | 'custom';

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  period: PeriodPreset;
}

function getPresetDates(preset: PeriodPreset): { start: string; end: string } {
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

const PRESET_LABELS: Record<PeriodPreset, string> = {
  today: 'Dzisiaj',
  week: 'Ten tydzień',
  month: 'Ten miesiąc',
  last_month: 'Poprzedni miesiąc',
  custom: 'Własny zakres',
};

interface DateRangePickerProps {
  onChange: (range: DateRange) => void;
  initialPeriod?: PeriodPreset;
}

export function DateRangePicker({ onChange, initialPeriod = 'month' }: DateRangePickerProps) {
  const [preset, setPreset] = useState<PeriodPreset>(initialPeriod);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const { start, end } = useMemo(() => {
    if (preset === 'custom') {
      return { start: customStart, end: customEnd };
    }
    return getPresetDates(preset);
  }, [preset, customStart, customEnd]);

  useEffect(() => {
    if (start && end && new Date(start) <= new Date(end)) {
      onChange({ start, end, period: preset });
    }
  }, [start, end, preset]);

  const rangeLabel = useMemo(() => {
    if (!start || !end) return '';
    const startDate = new Date(start);
    const endDate = new Date(end);
    endDate.setDate(endDate.getDate() - 1);

    const formatDate = (d: Date) =>
      d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });

    if (startDate.getTime() === endDate.getTime()) return formatDate(startDate);
    return `${formatDate(startDate)} - ${formatDate(endDate)}`;
  }, [start, end]);

  return (
    <div className="space-y-3">
      {/* Preset buttons */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map((p) => (
          <Button
            key={p}
            onClick={() => setPreset(p)}
            type="button"
            size="sm"
            variant="outline"
            className={`px-4 ${
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
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Od</label>
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Do</label>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="px-3 py-2 text-sm border border-border rounded-md bg-background focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
          {rangeLabel && (
            <div className="text-sm text-muted-foreground py-2">
              {rangeLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Helper do budowania query params
export function buildDateQueryParams(range: DateRange): string {
  if (range.period === 'custom') {
    return `start=${range.start}&end=${range.end}`;
  }
  return `period=${range.period}`;
}
