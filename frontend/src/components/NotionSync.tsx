import { useEffect, useState } from 'react';
import { formatDateTime } from '../utils/formatters';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

const API_URL = import.meta.env.VITE_API_URL || '';

type SyncResult = {
  saved: number;
  skipped: number;
  total_pages: number;
};

type NotionRow = {
  synced_at?: string;
};

export function NotionSync({
  token,
  onSynced,
}: {
  token: string;
  onSynced: () => void;
}) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const fetchLastSync = async () => {
    try {
      const [workersRes, projectsRes] = await Promise.all([
        fetch(`${API_URL}/api/notion/workers`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/api/notion/projects`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (!workersRes.ok || !projectsRes.ok) return;

      const workers = (await workersRes.json()) as NotionRow[];
      const projects = (await projectsRes.json()) as NotionRow[];

      const dates = [...workers, ...projects]
        .map((row) => row.synced_at)
        .filter(Boolean) as string[];

      if (dates.length === 0) {
        setLastSync(null);
        return;
      }

      const latest = dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
      setLastSync(latest);
    } catch {
      setLastSync(null);
    }
  };

  useEffect(() => {
    if (token) {
      fetchLastSync();
    }
  }, [token]);

  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);
    setStatus(null);
    setBackfillStatus(null);

    try {
      const [workersRes, projectsRes] = await Promise.all([
        fetch(`${API_URL}/api/notion/sync/workers`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_URL}/api/notion/sync/projects`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (!workersRes.ok || !projectsRes.ok) {
        throw new Error('Synchronizacja nie powiodła się');
      }

      const workersData = (await workersRes.json()) as SyncResult;
      const projectsData = (await projectsRes.json()) as SyncResult;

      setStatus(
        `Pracownicy: zapisano ${workersData.saved}, pominięto ${workersData.skipped}. ` +
          `Projekty: zapisano ${projectsData.saved}, pominięto ${projectsData.skipped}.`
      );

      await fetchLastSync();
      onSynced();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd synchronizacji');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleBackfill = async () => {
    setIsBackfilling(true);
    setError(null);
    setBackfillStatus(null);

    try {
      const response = await fetch(`${API_URL}/api/earnings/backfill-tasks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.details || 'Błąd uzupełniania zadań');
      }

      const data = await response.json();
      setBackfillStatus(
        `Zadania: uzupełniono ${data.updated} z ${data.requested}. ` +
          (data.failed ? `Niepowodzenia: ${data.failed}.` : 'Brak błędów.')
      );
      onSynced();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Błąd uzupełniania zadań');
    } finally {
      setIsBackfilling(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm text-muted-foreground">Synchronizacja z Notion</div>
            <div className="text-sm text-foreground">
              Ostatnia: {lastSync ? formatDateTime(lastSync) : 'brak'}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSync} disabled={isSyncing}>
              {isSyncing ? 'Synchronizuję...' : 'Synchronizuj'}
            </Button>
            <Button onClick={handleBackfill} disabled={isBackfilling} variant="outline">
              {isBackfilling ? 'Uzupełniam...' : 'Uzupełnij zadania'}
            </Button>
          </div>
        </div>

        {status && <div className="mt-3 text-sm text-foreground">{status}</div>}
        {backfillStatus && <div className="mt-3 text-sm text-foreground">{backfillStatus}</div>}
        {error && <div className="mt-3 text-sm text-destructive">{error}</div>}
      </CardContent>
    </Card>
  );
}
