# Plan implementacji: Earnings Split (godzinowe vs abonamenty)

Spec: `2026-03-25-earnings-split-design.md`

## Krok 1: Backend — konfiguracja prowizji

**Plik:** `backend/src/routes/admin.ts`

- Dodaj `SUBSCRIPTION_COMMISSION` do `ALLOWED_SETTINGS` (is_secret: false, is_restart_required: false)
- Seeduj domyślną wartość w `database.ts` → `seedAdminUser()` lub osobna funkcja:
  ```json
  {"81766381": 0.5, "44435339": 0.5}
  ```
  (Łukasz 50%, Filip 50%)

## Krok 2: Backend — helper do klasyfikacji projektów

**Plik:** `backend/src/routes/earnings.ts`

- Dodaj funkcję `classifyProject(hourly_rate, monthly_budget)` → `"hourly" | "subscription" | "unconfigured"`
- Dodaj helper `getSubscriptionCommission()` — parsuje JSON z `getConfig('SUBSCRIPTION_COMMISSION')`

## Krok 3: Backend — modyfikacja `/api/earnings/summary`

**Plik:** `backend/src/routes/earnings.ts` (endpoint `summary`)

Dodaj do response:
```ts
{
  // istniejące pola...
  hourly: { revenue, cost, profit, hours },
  subscriptions: {
    budget,      // suma monthly_budget aktywnych projektów abonamentowych
    cost,        // godziny × stawki pracowników w tych projektach
    profit,      // budget - cost
    hours,
    projects: [{ name, budget, cost, profit, hours }],
    commission: { "Łukasz Ślusarski": X, "Filip Górny": Y }
  },
  total: { revenue, cost, profit, hours }
}
```

**SQL:** dwa osobne zapytania — jedno z JOIN na `notion_projects WHERE hourly_rate > 0`, drugie z `monthly_budget > 0 AND hourly_rate = 0`.

## Krok 4: Backend — modyfikacja `/api/earnings/by-project`

**Plik:** `backend/src/routes/earnings.ts` (endpoint `by-project`)

- Dodaj pole `type: "hourly" | "subscription" | "unconfigured"` do każdego wiersza
- Dla abonamentowych: dodaj `budget` (monthly_budget) do response

## Krok 5: Backend — modyfikacja `/api/earnings/by-user`

**Plik:** `backend/src/routes/earnings.ts` (endpoint `by-user`)

- Zarobek = tylko z projektów godzinowych (hourly_rate > 0)
- Nowe pole `subscription_commission` — kwota prowizji jeśli user jest beneficjentem
- Nowe pole `total_earnings` = zarobek + prowizja

## Krok 6: Frontend — karty podsumowania

**Plik:** `frontend/src/components/EarningsTab.tsx`

Zmień 3 karty na górze:
- **Godzinowe:** przychód / koszt / zysk (tylko hourly projects)
- **Abonamenty:** budżet / koszt / zysk + prowizje
- **Razem:** suma obu

## Krok 7: Frontend — tabela per projekt

**Plik:** `frontend/src/components/EarningsTab.tsx`

- Dodaj badge "Godzinowy" / "Abonament" w kolumnie projektu
- Dla abonamentów: pokaż "Budżet" zamiast "Stawka (PLN/H)"
- Opcjonalnie: filtr po typie

## Krok 8: Frontend — tabela per osoba

**Plik:** `frontend/src/components/EarningsTab.tsx`

- Kolumna "Zarobek" → tylko godzinówki
- Nowa kolumna "Prowizja" → udział w zysku abonamentowym
- Kolumna "Suma" → zarobek + prowizja

## Krok 9: Frontend — sekcja abonamentów

**Plik:** `frontend/src/components/EarningsTab.tsx`

Nowa sekcja (Card) pod podsumowaniem:
- Tabela: Projekt | Budżet | Godziny | Koszt | Zysk
- Wiersz podsumowania
- Podział prowizji: Łukasz 50% = X zł, Filip 50% = X zł

## Krok 10: Test i deploy

- Przetestuj lokalnie z danymi z dzisiaj
- Sprawdź czy total zgadza się z sumą godzinowe + abonamenty
- Deploy na serwer (git push → Coolify, sprawdzić loadbalancer labels)

## Zależności między krokami

- Kroki 1-5 (backend) mogą być zrobione razem
- Kroki 6-9 (frontend) zależą od 3-5
- Krok 10 po wszystkim

## Pliki do modyfikacji

| Plik | Zmiana |
|---|---|
| `backend/src/routes/earnings.ts` | Główne zmiany — klasyfikacja, split, prowizja |
| `backend/src/routes/admin.ts` | SUBSCRIPTION_COMMISSION w ALLOWED_SETTINGS |
| `backend/src/database.ts` | Seed domyślnej prowizji |
| `frontend/src/components/EarningsTab.tsx` | UI — karty, tabele, sekcja abonamentów |
