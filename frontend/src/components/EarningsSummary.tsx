import { formatCurrency, formatHours } from '../utils/formatters';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

type EarningsTotals = {
  total_revenue?: number;
  total_cost?: number;
  total_profit: number;
  total_hours: number;
};

type EarningsEntries = {
  total: number;
  mapped: number;
  unmapped: number;
};

export function EarningsSummary({
  totals,
  entries,
  isAdmin,
  showUnmappedDetails = false,
  onToggleUnmapped,
}: {
  totals: EarningsTotals;
  entries: EarningsEntries;
  isAdmin: boolean;
  showUnmappedDetails?: boolean;
  onToggleUnmapped?: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-1 ${isAdmin ? 'md:grid-cols-4' : 'md:grid-cols-2'} gap-4`}>
        {isAdmin && (
          <>
            <Card>
              <CardContent className="p-6">
                <div className="text-sm text-muted-foreground">Przychód</div>
                <div className="text-2xl font-bold text-highlight-3">{formatCurrency(totals.total_revenue || 0)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="text-sm text-muted-foreground">Koszt</div>
                <div className="text-2xl font-bold text-highlight-4">{formatCurrency(totals.total_cost || 0)}</div>
              </CardContent>
            </Card>
          </>
        )}
        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-muted-foreground">Zysk</div>
            <div className="text-2xl font-bold text-highlight-1">{formatCurrency(totals.total_profit)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-muted-foreground">Godziny</div>
            <div className="text-2xl font-bold text-highlight-2">{formatHours(totals.total_hours)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="bg-muted rounded-lg p-4 text-sm text-foreground">
        <span className="font-medium">Wpisy czasu:</span> {entries.total}
        <span className="ml-2">Zmapowane: {entries.mapped} / {entries.total}</span>
        {entries.unmapped > 0 && (
          <>
            <span className="ml-2 text-primary">Niezmapowane: {entries.unmapped}</span>
            {onToggleUnmapped && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onToggleUnmapped}
                className="ml-3 h-7 px-2"
              >
                {showUnmappedDetails ? 'Schowaj przyczyny' : 'Pokaż przyczyny'}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
