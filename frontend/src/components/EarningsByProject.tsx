import { formatCurrency, formatCurrencyPerHour, formatHours } from '../utils/formatters';

export type EarningsProjectRow = {
  project_clickup_id: string;
  project_name: string;
  project_rate?: number;
  monthly_budget?: number;
  hours_worked: number;
  revenue?: number;
  cost?: number;
  profit: number;
  workers_count?: number;
  tasks_count?: number;
  entries_count: number;
  type?: 'hourly' | 'subscription' | 'unconfigured';
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
                  Stawka / Budżet
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
                  {row.type === 'subscription' && (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                      Abonament
                    </span>
                  )}
                  {row.type === 'hourly' && (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      Godzinowy
                    </span>
                  )}
                </td>
                {isAdmin && (
                  <td className="px-6 py-4 whitespace-nowrap text-right text-foreground">
                    {row.type === 'subscription'
                      ? formatCurrency(row.monthly_budget || 0) + '/mies.'
                      : formatCurrencyPerHour(row.project_rate || 0)}
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
