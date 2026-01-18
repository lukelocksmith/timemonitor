import { formatCurrency, formatCurrencyPerHour, formatHours } from '../utils/formatters';

export type EarningsUserRow = {
  user_id: string;
  user_name: string;
  worker_rate?: number;
  hours_worked: number;
  revenue?: number;
  cost?: number;
  profit: number;
  tasks_count?: number;
  entries_count: number;
};

export function EarningsByUser({ rows, isAdmin }: { rows: EarningsUserRow[]; isAdmin: boolean }) {
  return (
    <div className="bg-card rounded-2xl overflow-hidden border border-border">
      <div className="px-6 py-4 border-b border-border">
        <h3 className="text-lg font-semibold text-foreground">Zarobki per osoba</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Osoba
              </th>
              {isAdmin && (
                <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Stawka (PLN/h)
                </th>
              )}
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Godziny
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Zysk
              </th>
              {isAdmin && (
                <>
                  <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Zarobek
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Przychód
                  </th>
                </>
              )}
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Wpisy
              </th>
            </tr>
          </thead>
          <tbody className="bg-card divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.user_id}>
                <td className="px-6 py-4 whitespace-nowrap text-foreground font-medium">
                  {row.user_name}
                </td>
                {isAdmin && (
                  <td className="px-6 py-4 whitespace-nowrap text-right text-foreground">
                    {formatCurrencyPerHour(row.worker_rate || 0)}
                  </td>
                )}
                <td className="px-6 py-4 whitespace-nowrap text-right text-foreground">
                  {formatHours(row.hours_worked)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-highlight-1 font-semibold">
                  {formatCurrency(row.profit)}
                </td>
                {isAdmin && (
                  <>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-foreground">
                      {formatCurrency(row.cost || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-foreground">
                      {formatCurrency(row.revenue || 0)}
                    </td>
                  </>
                )}
                <td className="px-6 py-4 whitespace-nowrap text-right text-muted-foreground">
                  {row.entries_count}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 7 : 4} className="px-6 py-8 text-center text-muted-foreground">
                  Brak danych dla wybranego okresu
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
