export function formatCurrency(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    maximumFractionDigits: 2,
  }).format(safeValue);
}

export function formatCurrencyPerHour(value: number): string {
  return `${formatCurrency(value)} / h`;
}

export function formatHours(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `${safeValue.toFixed(2)} h`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('pl-PL');
}
