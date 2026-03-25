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

type SplitData = {
  hourly?: { revenue: number; cost: number; profit: number; hours: number };
  subscriptions?: {
    budget: number;
    cost: number;
    profit: number;
    hours: number;
    projects: Array<{ name: string; budget: number; cost: number; profit: number; hours: number }>;
    commission: Record<string, number>;
  };
  total?: { revenue: number; cost: number; profit: number; hours: number };
};

export function EarningsSummary({
  totals,
  entries,
  isAdmin,
  showUnmappedDetails = false,
  onToggleUnmapped,
  split,
}: {
  totals: EarningsTotals;
  entries: EarningsEntries;
  isAdmin: boolean;
  showUnmappedDetails?: boolean;
  onToggleUnmapped?: () => void;
  split?: SplitData;
}) {
  const hasSplit = split && split.hourly && split.subscriptions && split.total;

  return (
    <div className="space-y-4">
      {hasSplit && isAdmin ? (
        <div className="space-y-3">
          {/* Godzinowe */}
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Godzinowe</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Przychód</div>
                  <div className="text-xl font-bold text-highlight-3">{formatCurrency(split.hourly!.revenue)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Koszt</div>
                  <div className="text-xl font-bold text-highlight-4">{formatCurrency(split.hourly!.cost)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Zysk</div>
                  <div className="text-xl font-bold text-highlight-1">{formatCurrency(split.hourly!.profit)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Godziny</div>
                  <div className="text-xl font-bold text-highlight-2">{formatHours(split.hourly!.hours)}</div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Abonamenty */}
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Abonamenty</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Budżet</div>
                  <div className="text-xl font-bold text-highlight-3">{formatCurrency(split.subscriptions!.budget)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Koszt</div>
                  <div className="text-xl font-bold text-highlight-4">{formatCurrency(split.subscriptions!.cost)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Zysk</div>
                  <div className="text-xl font-bold text-highlight-1">{formatCurrency(split.subscriptions!.profit)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Godziny</div>
                  <div className="text-xl font-bold text-highlight-2">{formatHours(split.subscriptions!.hours)}</div>
                </CardContent>
              </Card>
            </div>
            {/* Projekty abonamentowe */}
            {split.subscriptions!.projects.length > 0 && (
              <div className="mt-2 bg-muted rounded-lg p-3 text-sm">
                <div className="grid grid-cols-5 gap-2 text-xs text-muted-foreground font-medium mb-1">
                  <span>Projekt</span>
                  <span className="text-right">Budżet</span>
                  <span className="text-right">Godziny</span>
                  <span className="text-right">Koszt</span>
                  <span className="text-right">Zysk</span>
                </div>
                {split.subscriptions!.projects.map((p) => (
                  <div key={p.name} className="grid grid-cols-5 gap-2 text-foreground">
                    <span className="truncate">{p.name}</span>
                    <span className="text-right">{formatCurrency(p.budget)}</span>
                    <span className="text-right">{formatHours(p.hours)}</span>
                    <span className="text-right">{formatCurrency(p.cost)}</span>
                    <span className="text-right font-medium">{formatCurrency(p.profit)}</span>
                  </div>
                ))}
              </div>
            )}
            {/* Prowizje */}
            {Object.keys(split.subscriptions!.commission).length > 0 && (
              <div className="mt-2 bg-muted rounded-lg p-3 text-sm">
                <span className="text-xs text-muted-foreground font-medium">Prowizje:</span>
                {Object.entries(split.subscriptions!.commission).map(([name, amount]) => (
                  <span key={name} className="ml-3 text-foreground">
                    {name}: <span className="font-medium">{formatCurrency(amount)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Razem */}
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Razem</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Card className="border-2 border-border">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Przychód</div>
                  <div className="text-xl font-bold text-highlight-3">{formatCurrency(split.total!.revenue)}</div>
                </CardContent>
              </Card>
              <Card className="border-2 border-border">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Koszt</div>
                  <div className="text-xl font-bold text-highlight-4">{formatCurrency(split.total!.cost)}</div>
                </CardContent>
              </Card>
              <Card className="border-2 border-border">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Zysk</div>
                  <div className="text-xl font-bold text-highlight-1">{formatCurrency(split.total!.profit)}</div>
                </CardContent>
              </Card>
              <Card className="border-2 border-border">
                <CardContent className="p-4">
                  <div className="text-xs text-muted-foreground">Godziny</div>
                  <div className="text-xl font-bold text-highlight-2">{formatHours(split.total!.hours)}</div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      ) : (
        /* Fallback: oryginalny widok */
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
      )}

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
