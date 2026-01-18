# Plan: Statystyki Zarobków i Zysku

## Podsumowanie

Rozbudowa ClickUp Activity Monitor o wyświetlanie:
- **Zarobki pracownika** = stawka pracownika × przepracowane godziny
- **Przychód brutto** = stawka projektu × przepracowane godziny
- **Zysk brutto** = (stawka projektu - stawka pracownika) × przepracowane godziny

---

## 1. Źródła Danych

### 1.1 ClickUp (już zintegrowane)
- `time_entries` - wpisy czasu z task_id, user_id, duration
- `tasks` - zadania z project/folder info
- Webhook events już zapisują dane do SQLite

### 1.2 Notion - Pracownicy
**Database ID:** `605f5d43-a76a-4e71-910d-f82d501ea91f`
**Data Source ID:** `6b5e876e-d8e5-45d5-9b4c-0ca18a3e38a7`

| Pole | Typ | Opis |
|------|-----|------|
| `Imię i nazwisko` | title | Nazwa pracownika |
| `ClickUp ID` | text | ID użytkownika w ClickUp (do mapowania) |
| `Stawka godzinowe` | number | Stawka PLN/h pracownika |
| `Status` | select | "Aktywny" / "NIe aktywny" |
| `Email` | email | Email pracownika |

### 1.3 Notion - Projekty
**Database ID:** `e237c852-46fe-4ed0-bc6c-58b303eff615` (B: PROJEKT)
**Data Source ID:** `2138e047-35a6-45f3-bab7-7e9e62d438d2`

| Pole | Typ | Opis |
|------|-----|------|
| `Name` | title | Nazwa projektu |
| `Średnia wartość za godzinę` | number | Stawka PLN/h dla klienta |
| `ID clickup` | **formula** | ID projektu/listy z ClickUp (wyciągane z URL) |
| `Clickup` | url | Link do ClickUp |
| `Do projektu w clickup` | url | Link do projektu w ClickUp |
| `Status` | status | Szansa/Kwalifikacja/Oferta/Współpraca/Archiwum/Odrzucona |
| `Tags` | multi_select | godzinowy / fix priced / wordpress |

---

## 2. Mapowanie Danych

### 2.1 Istniejące mapowania w Notion
**DOBRA WIADOMOŚĆ:** Mapowanie już istnieje w Notion!

```
ClickUp user_id  →  Notion Pracownicy."ClickUp ID"  →  Stawka pracownika
ClickUp list_id  →  Notion B:PROJEKT."ID clickup"   →  Stawka projektu
```

### 2.2 Mapowanie użytkowników
W bazie **Pracownicy** pole `ClickUp ID` (text) przechowuje ID użytkownika z ClickUp:
- ClickUp user `6800321` → Notion pracownik z `ClickUp ID = "6800321"`

### 2.3 Mapowanie projektów
W bazie **B: PROJEKT** pole `Clickup` zawiera URL w formacie:
```
https://app.clickup.com/{workspace_id}/v/li/{list_id}
```

**Przykład (projekt Onyx):**
- URL: `https://app.clickup.com/4552118/v/li/901213438791`
- Workspace ID: `4552118`
- **List ID: `901213438791`** ← używamy do mapowania

Formuła `ID clickup` wyciąga `list_id` z tego URL.

**NIE TRZEBA** dodawać nowych pól - wystarczy sparsować URL lub użyć formułę!

---

## 3. Nowe Tabele SQLite

### 3.1 `notion_workers` - Cache pracowników
```sql
CREATE TABLE notion_workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notion_page_id TEXT UNIQUE NOT NULL,
  clickup_user_id TEXT,
  name TEXT NOT NULL,
  hourly_rate REAL DEFAULT 0,
  status TEXT DEFAULT 'Aktywny',
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notion_workers_clickup ON notion_workers(clickup_user_id);
```

### 3.2 `notion_projects` - Cache projektów
```sql
CREATE TABLE notion_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notion_page_id TEXT UNIQUE NOT NULL,
  clickup_id TEXT,              -- Z pola "ID clickup" (formula) w Notion
  name TEXT NOT NULL,
  hourly_rate REAL DEFAULT 0,   -- Z pola "Średnia wartość za godzinę"
  status TEXT,                  -- Współpraca/Archiwum/etc.
  tags TEXT,                    -- godzinowy/fix priced
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_notion_projects_clickup ON notion_projects(clickup_id);
```

### 3.3 `project_mappings` - NIE POTRZEBNE
~~Mapowanie ClickUp → Notion~~

**Mapowanie już istnieje w Notion** przez pole `ID clickup` (formula).
Tabela `notion_projects` będzie przechowywać `clickup_id` bezpośrednio z Notion.

---

## 4. Nowe Endpointy API

### 4.1 Synchronizacja Notion

| Endpoint | Metoda | Dostęp | Opis |
|----------|--------|--------|------|
| `POST /api/notion/sync/workers` | POST | admin | Sync pracowników z Notion |
| `POST /api/notion/sync/projects` | POST | admin | Sync projektów z Notion |
| `GET /api/notion/workers` | GET | admin | Lista zsynchronizowanych pracowników |
| `GET /api/notion/projects` | GET | admin | Lista zsynchronizowanych projektów |

### 4.2 Statystyki zarobków

| Endpoint | Metoda | Dostęp | Opis |
|----------|--------|--------|------|
| `GET /api/earnings/summary` | GET | admin | Podsumowanie zarobków i zysków |
| `GET /api/earnings/by-user` | GET | admin | Zarobki per użytkownik |
| `GET /api/earnings/by-project` | GET | admin | Przychody per projekt |
| `GET /api/earnings/details` | GET | admin | Szczegółowe wpisy z kalkulacjami |

### 4.3 ~~Mapowanie projektów~~ - NIE POTRZEBNE
Mapowanie jest już w Notion (pole `ID clickup`), więc nie potrzeba osobnych endpointów.

---

## 5. Integracja Notion API

### 5.1 Konfiguracja
Dodaj do `.env`:
```
NOTION_API_KEY=secret_xxx
NOTION_WORKERS_DB=6b5e876e-d8e5-45d5-9b4c-0ca18a3e38a7
NOTION_PROJECTS_DB=1a4de922-1179-80a1-8e07-c7e22a04ce08
```

### 5.2 Zależności
```bash
npm install @notionhq/client
```

### 5.3 Pliki do utworzenia
```
backend/src/
  notion/
    client.ts         # Notion API client
    sync.ts           # Funkcje synchronizacji
    types.ts          # Typy TypeScript
  routes/
    notion.ts         # Endpointy /api/notion/*
    earnings.ts       # Endpointy /api/earnings/*
```

### 5.4 Przykład query do Notion
```typescript
import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });

// ═══════════════════════════════════════════
// Pobranie PRACOWNIKÓW
// ═══════════════════════════════════════════
const workers = await notion.databases.query({
  database_id: process.env.NOTION_WORKERS_DS!,
  filter: {
    property: 'Status',
    select: { equals: 'Aktywny' }
  }
});

// Mapowanie pracowników
workers.results.map(page => ({
  notion_page_id: page.id,
  clickup_user_id: page.properties['ClickUp ID']?.rich_text?.[0]?.plain_text,
  name: page.properties['Imię i nazwisko']?.title?.[0]?.plain_text,
  hourly_rate: page.properties['Stawka godzinowe']?.number || 0,
}));

// ═══════════════════════════════════════════
// Pobranie PROJEKTÓW
// ═══════════════════════════════════════════
const projects = await notion.databases.query({
  database_id: process.env.NOTION_PROJECTS_DS!,
  filter: {
    property: 'Status',
    status: { equals: 'Współpraca' }  // Tylko aktywne projekty
  }
});

// Funkcja do wyciągania list_id z URL ClickUp
function extractClickUpListId(url: string | null): string | null {
  if (!url) return null;
  // Format: https://app.clickup.com/{workspace}/v/li/{list_id}
  const match = url.match(/\/li\/(\d+)/);
  return match ? match[1] : null;
}

// Mapowanie projektów
projects.results.map(page => ({
  notion_page_id: page.id,
  clickup_id: extractClickUpListId(page.properties['Clickup']?.url),
  name: page.properties['Name']?.title?.[0]?.plain_text,
  hourly_rate: page.properties['Średnia wartość za godzinę']?.number || 0,
  status: page.properties['Status']?.status?.name,
}));
```

---

## 6. Algorytm Kalkulacji

### 6.1 Zarobki pracownika
```typescript
// Dla każdego wpisu czasu
const workerEarnings = timeEntry.duration_hours * worker.hourly_rate;
```

### 6.2 Przychód z projektu
```typescript
// Dla każdego wpisu czasu
const projectRevenue = timeEntry.duration_hours * project.hourly_rate;
```

### 6.3 Zysk brutto
```typescript
// Uproszczona formuła: (stawka projektu - stawka pracownika) × czas
const grossProfit = (project.hourly_rate - worker.hourly_rate) * timeEntry.duration_hours;
const profitMargin = ((project.hourly_rate - worker.hourly_rate) / project.hourly_rate) * 100; // %
```

### 6.4 Agregacja
```sql
-- Zarobki per pracownik w okresie
SELECT
  nw.name,
  nw.hourly_rate,
  SUM(te.duration) / 3600000.0 as hours_worked,
  SUM(te.duration) / 3600000.0 * nw.hourly_rate as total_earnings
FROM time_entries te
JOIN notion_workers nw ON te.user_id = nw.clickup_user_id
WHERE te.start >= ? AND te.end <= ?
GROUP BY nw.clickup_user_id;

-- Zysk per projekt (uproszczona formuła, bez tabeli mapowań)
-- UWAGA: time_entries nie ma list_id, trzeba JOIN przez tasks!
SELECT
  np.name as project_name,
  np.hourly_rate as project_rate,
  nw.name as worker_name,
  nw.hourly_rate as worker_rate,
  SUM(te.duration) / 3600000.0 as hours_worked,
  SUM(te.duration) / 3600000.0 * np.hourly_rate as revenue,
  SUM(te.duration) / 3600000.0 * nw.hourly_rate as cost,
  -- Zysk = (stawka projektu - stawka pracownika) × czas
  SUM(te.duration) / 3600000.0 * (np.hourly_rate - nw.hourly_rate) as profit
FROM time_entries te
JOIN tasks t ON te.task_id = t.id
JOIN notion_workers nw ON te.user_id = nw.clickup_user_id
JOIN notion_projects np ON t.list_id = np.clickup_id
WHERE te.start_time >= ? AND te.end_time <= ?
GROUP BY np.notion_page_id, nw.clickup_user_id;
```

---

## 7. Zmiany Frontend

### 7.1 Nowe komponenty
```
frontend/src/
  components/
    EarningsTab.tsx        # Główna zakładka zarobków
    EarningsSummary.tsx    # Podsumowanie (karty)
    EarningsByUser.tsx     # Tabela per pracownik
    EarningsByProject.tsx  # Tabela per projekt
    NotionSync.tsx         # Przycisk synchronizacji + status
```

### 7.2 Nowa zakładka w App.tsx
Dodać tab "Zarobki" (tylko dla admin):
- Podsumowanie: łączne przychody, koszty, zysk
- Wykres: zarobki per osoba
- Tabela: szczegóły per projekt
- Przycisk: synchronizacja z Notion + data ostatniej sync

### 7.3 Widoczność według roli
- **Admin**: widzi wszystko (zarobki, koszty, zyski, stawki)
- **User (PMA)**: widzi tylko aktywność BEZ danych finansowych

---

## 8. Uwagi Bezpieczeństwa

### 8.1 Ochrona danych finansowych
- Endpointy `/api/earnings/*` tylko dla admina
- Endpointy `/api/notion/*` tylko dla admina
- Frontend nie pokazuje stawek dla roli `user`

### 8.2 Notion API
- Token Notion NIE może być wystawiony publicznie
- Synchronizacja tylko z backendu
- Cache w SQLite zapobiega rate limiting

---

## 9. Kolejność Implementacji

### Faza 1: Backend - Notion Integration
1. [ ] Zainstalować `@notionhq/client`
2. [ ] Utworzyć `notion/client.ts` - inicjalizacja klienta
3. [ ] Utworzyć `notion/types.ts` - interfejsy TypeScript
4. [ ] Dodać tabele SQLite: `notion_workers`, `notion_projects`
5. [ ] Utworzyć `notion/sync.ts` - funkcje synchronizacji (pobiera też `ID clickup`)
6. [ ] Utworzyć `routes/notion.ts` - endpointy sync

### Faza 2: Backend - Kalkulacje
7. [ ] Utworzyć `routes/earnings.ts` - endpointy statystyk
8. [ ] Zaimplementować agregacje SQL (JOIN przez clickup_id)
9. [ ] Dodać filtrowanie po dacie

### Faza 3: Frontend - UI
10. [ ] Utworzyć `EarningsTab.tsx` - główny komponent
11. [ ] Utworzyć `EarningsSummary.tsx` - karty podsumowania
12. [ ] Utworzyć `EarningsByUser.tsx` - tabela pracowników
13. [ ] Utworzyć `EarningsByProject.tsx` - tabela projektów
14. [ ] Dodać zakładkę do `App.tsx`

### Faza 4: Frontend - Admin
15. [ ] Utworzyć `NotionSync.tsx` - przycisk synchronizacji
16. [ ] Integracja z AdminPanel

### Faza 5: Testowanie
17. [ ] Przetestować sync z Notion
18. [ ] Przetestować kalkulacje
19. [ ] Sprawdzić uprawnienia (admin vs user)

---

## 10. Pytania do Rozstrzygnięcia

1. ~~**Mapowanie projektów**~~ ✅ ROZWIĄZANE
   - Pole `ID clickup` w Notion już zawiera ID z ClickUp

2. **Częstotliwość synchronizacji**:
   - Ręczna (przycisk)?
   - Automatyczna (co X minut)?
   - Webhook z Notion?

3. **Historyczne dane**: Czy liczyć zarobki wstecz dla istniejących wpisów czasu?

4. **Waluta**: Czy wszystko w PLN czy obsługa wielu walut?

5. **Projekty bez ID ClickUp**: Co z projektami w Notion bez wypełnionego `ID clickup`?
   - Pominąć w statystykach?
   - Pokazać jako "Nieprzypisane"?

---

## 11. Zmienne Środowiskowe

Dodaj do `.env`:
```bash
# Notion Integration
NOTION_API_KEY=secret_xxx

# Data Source IDs (nie Database IDs!)
NOTION_WORKERS_DS=6b5e876e-d8e5-45d5-9b4c-0ca18a3e38a7
NOTION_PROJECTS_DS=2138e047-35a6-45f3-bab7-7e9e62d438d2
```

**UWAGA:** Używamy Data Source ID (collection://), nie Database ID!

---

## 12. Referencje

- [Notion API Documentation](https://developers.notion.com/)
- [Notion SDK for JavaScript](https://github.com/makenotion/notion-sdk-js)

### Notion IDs
| Zasób | Database ID | Data Source ID |
|-------|-------------|----------------|
| Pracownicy | `605f5d43-a76a-4e71-910d-f82d501ea91f` | `6b5e876e-d8e5-45d5-9b4c-0ca18a3e38a7` |
| B: PROJEKT | `e237c852-46fe-4ed0-bc6c-58b303eff615` | `2138e047-35a6-45f3-bab7-7e9e62d438d2` |

### Linki
- Baza Pracownicy: https://www.notion.so/605f5d43a76a4e71910df82d501ea91f
- Baza Projekty: https://www.notion.so/e237c85246fe4ed0bc6c58b303eff615
