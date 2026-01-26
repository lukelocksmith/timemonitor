// Maksymalny czas trwania pojedynczego wpisu: 12 godzin (w milisekundach).
// Wpisy przekraczające ten limit są pomijane przy imporcie i filtrowane w zapytaniach.
// Zapobiega sytuacjom, gdy ktoś zapomni wyłączyć timer (np. 81h).
export const MAX_ENTRY_DURATION_MS = 12 * 60 * 60 * 1000; // 12h = 43200000ms

// Fragment SQL do filtrowania wpisów w zapytaniach.
// Użycie: dodaj do WHERE clause w zapytaniach na time_entries.
export const DURATION_FILTER_SQL = `AND te.duration > 0 AND te.duration <= ${MAX_ENTRY_DURATION_MS}`;

// Maksymalna liczba wpisów do pobrania per użytkownik przy imporcie.
// Zabezpieczenie przed nieskończoną paginacją ClickUp API (bug: API zwraca
// pełne strony w kółko, nie kończąc się nigdy dla niektórych użytkowników).
export const MAX_IMPORT_ENTRIES_PER_USER = 10_000;
