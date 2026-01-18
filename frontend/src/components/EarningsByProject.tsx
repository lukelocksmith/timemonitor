import { formatCurrency, formatCurrencyPerHour, formatHours } from '../utils/formatters';

export type EarningsProjectRow = {
  project_clickup_id: string;
  project_name: string;
  project_rate?: number;
  hours_worked: number;
  revenue?: number;
  cost?: number;
  profit: number;
  workers_count?: number;
  tasks_count?: number;
  entries_count: number;
};

export function EarningsByProject({ rows, isAdmin }: { rows: EarningsProjectRow[]; isAdmin: boolean }) {
  return (
    <div className="bg-card rounded-2xl overflow-hidden border border-border">
      <div className="px-6 py-4 border-b border-border">
        <h3 className="text-lg font-semibold text-foreground">Zarobki per projekt</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Projekt
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
                    Przychód
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Koszt
                  </th>
                </>
              )}
              <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Osoby
              </th>
            </tr>
          </thead>
          <tbody className="bg-card divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.project_clickup_id}>
                <td className="px-6 py-4 whitespace-nowrap text-foreground font-medium">
                  {row.project_name}
                </td>
                {isAdmin && (
                  <td className="px-6 py-4 whitespace-nowrap text-right text-foreground">
                    {formatCurrencyPerHour(row.project_rate || 0)}
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
                      {formatCurrency(row.revenue || 0)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-foreground">
                      {formatCurrency(row.cost || 0)}
                    </td>
                  </>
                )}
                <td className="px-6 py-4 whitespace-nowrap text-right text-muted-foreground">
                  {row.workers_count ?? '-'}
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
