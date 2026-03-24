# Earnings Split: Godzinowe vs Abonamenty

## Problem

Dashboard liczy zarobki jednolicie — projekty abonamentowe (monthly_budget) i godzinowe (hourly_rate) mieszają się w jednym widoku. Skutek: Filip ma "zysk 2486 zł" za 2h pracy bo system wlicza mu cały budżet EFF/SEO.

## Design

### Klasyfikacja projektów

Projekt jest **godzinowy** gdy `hourly_rate > 0`.
Projekt jest **abonamentowy** gdy `monthly_budget > 0` i `hourly_rate = 0`.
Projekt jest **nieskonfigurowany** gdy oba = 0.

### Backend: nowy endpoint `/api/earnings/summary-split`

Zwraca dane podzielone na kategorie:

```json
{
  "period": "month",
  "hourly": {
    "revenue": 1200.00,
    "cost": 800.00,
    "profit": 400.00,
    "hours": 8.5
  },
  "subscriptions": {
    "budget": 4000.00,
    "cost": 500.00,
    "profit": 3500.00,
    "hours": 5.2,
    "projects": [
      {
        "name": "EFF/SEO",
        "budget": 2000,
        "cost": 55.41,
        "profit": 1944.59,
        "hours": 0.62
      }
    ],
    "commission": {
      "Łukasz Ślusarski": 1750.00,
      "Filip Górny": 1750.00
    }
  },
  "total": {
    "revenue": 5200.00,
    "cost": 1300.00,
    "profit": 3900.00,
    "hours": 13.7
  }
}
```

**Logika prowizji:** zysk abonamentowy × 50% per osoba. Na razie hardcoded dwóch beneficjentów (Łukasz + Filip, po 50%). Konfiguracja w `app_settings` jako JSON:

```
SUBSCRIPTION_COMMISSION = {"81766381": 0.5, "44435339": 0.5}
```

(ClickUp user ID → procent)

### Backend: modyfikacja istniejących endpointów

**`/api/earnings/by-project`** — dodaje pole `type: "hourly" | "subscription" | "unconfigured"` do każdego projektu.

**`/api/earnings/by-user`** — liczy zarobki pracownika **tylko z projektów godzinowych**. Osobne pole `subscription_commission` z kwotą prowizji (jeśli pracownik jest beneficjentem).

**`/api/earnings/summary`** — dodaje breakdown: `hourly_revenue`, `subscription_revenue`, `subscription_profit`, `subscription_commission`.

### Frontend: EarningsTab zmiany

**Karty podsumowania (góra):**
Zamiast jednej karty "Przychód / Koszt / Zysk", trzy:
1. **Godzinowe** — przychód z hourly_rate × godziny
2. **Abonamenty** — budżet vs koszt, zysk, prowizje
3. **Razem** — suma

**Tabela "per projekt":**
- Nowa kolumna "Typ" z badge (godzinowy/abonament)
- Filtrowalny po typie
- Projekty abonamentowe pokazują "Budżet" zamiast "Stawka"

**Tabela "per osoba":**
- Kolumna "Zarobek" = tylko z godzinówek
- Nowa kolumna "Prowizja" = udział w zysku abonamentowym (jeśli dotyczy)
- Kolumna "Suma" = zarobek + prowizja

**Nowa sekcja "Abonamenty":**
Mała tabela pod podsumowaniem:
- Projekt | Budżet | Godziny | Koszt | Zysk
- Podsumowanie: łączny zysk abonamentowy
- Podział prowizji: Łukasz 50% = X zł, Filip 50% = X zł

## Scope

- Modyfikacja 2 plików backend (earnings.ts, ewentualnie home.ts)
- Modyfikacja 1 pliku frontend (EarningsTab.tsx)
- Dodanie konfiguracji prowizji w app_settings
- Bez zmian w schemacie bazy danych
