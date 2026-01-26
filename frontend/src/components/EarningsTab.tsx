import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { EarningsSummary } from './EarningsSummary';
import { EarningsByUser, EarningsUserRow } from './EarningsByUser';
import { EarningsByProject, EarningsProjectRow } from './EarningsByProject';
import { NotionSync } from './NotionSync';
import { DateRangePicker, DateRange, buildDateQueryParams } from './DateRangePicker';
import { UnmappedEntries } from './UnmappedEntries';
type EarningsTabProps = {
  showNotionSync?: boolean;
};

const API_URL = import.meta.env.VITE_API_URL || '';

type EarningsSummaryResponse = {
  totals: {
    total_revenue?: number;
    total_cost?: number;
    total_profit: number;
    total_hours: number;
  };
  entries: {
    total: number;
    mapped: number;
    unmapped: number;
  };
};

export function EarningsTab({ showNotionSync = false }: EarningsTabProps) {
  const { token, isAdmin, user } = useAuth();
  const showUserRate = user?.role === 'user';
  const [dateRange, setDateRange] = useState<DateRange>({ start: '', end: '', period: 'today' });
  const [summary, setSummary] = useState<EarningsSummaryResponse | null>(null);
  const [byUser, setByUser] = useState<EarningsUserRow[]>([]);
  const [byProject, setByProject] = useState<EarningsProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUnmappedOpen, setIsUnmappedOpen] = useState(false);

  const fetchEarnings = async () => {
    if (!token || !dateRange.start || !dateRange.end) return;
    setLoading(true);
    setError(null);

    try {
      const queryParams = buildDateQueryParams(dateRange);

      const [summaryRes, byUserRes, byProjectRes] = await Promise.all([
        fetch(`${API_URL}/api/earnings/summary?${queryParams}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/api/earnings/by-user?${queryParams}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/api/earnings/by-project?${queryParams}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (!summaryRes.ok || !byUserRes.ok || !byProjectRes.ok) {
        throw new Error('Błąd pobierania danych zarobków');
      }

      const summaryData = (await summaryRes.json()) as EarningsSummaryResponse;
      const byUserData = (await byUserRes.json()) as { users: EarningsUserRow[] };
      const byProjectData = (await byProjectRes.json()) as { projects: EarningsProjectRow[] };

      setSummary(summaryData);
      setByUser(byUserData.users || []);
      setByProject(byProjectData.projects || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd pobierania danych');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEarnings();
  }, [dateRange, token]);

  useEffect(() => {
    if (summary && summary.entries.unmapped === 0) {
      setIsUnmappedOpen(false);
    }
  }, [summary]);

  if (!token) {
    return null;
  }

  return (
    <div className="space-y-6">
      {isAdmin && showNotionSync && (
        <NotionSync token={token} onSynced={fetchEarnings} />
      )}

      <DateRangePicker onChange={setDateRange} initialPeriod="today" />

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Ładowanie...</div>
      ) : error ? (
        <div className="text-center py-8 text-red-600">{error}</div>
      ) : summary ? (
        <>
          <EarningsSummary
            totals={summary.totals}
            entries={summary.entries}
            isAdmin={isAdmin}
            showUnmappedDetails={isUnmappedOpen}
            onToggleUnmapped={isAdmin ? () => setIsUnmappedOpen((prev) => !prev) : undefined}
          />

          {/* Niezmapowane wpisy - rozwijalna sekcja */}
          {isAdmin && summary.entries.unmapped > 0 && isUnmappedOpen && (
            <UnmappedEntries dateRange={dateRange} unmappedCount={summary.entries.unmapped} />
          )}

          <EarningsByUser rows={byUser} isAdmin={isAdmin} showUserRate={showUserRate} />
          <EarningsByProject rows={byProject} isAdmin={isAdmin} />
        </>
      ) : (
        <div className="text-center py-8 text-muted-foreground">Brak danych</div>
      )}
    </div>
  );
}
