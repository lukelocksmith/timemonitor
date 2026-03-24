# ClickUp Activity Monitor — Architektura

## Przegląd

Real-time dashboard pokazujący kto aktualnie pracuje nad jakim zadaniem w ClickUp. Monitoruje time tracking, wyświetla aktywne sesje, historię pracy i zarobki zespołu.

**URL produkcyjny:** https://monitor.important.is
**Repo:** https://github.com/lukelocksmith/timemonitor (branch: main)
**Hosting:** Coolify na Hetzner (65.21.75.39), UUID aplikacji: `owkkkkgcw000wk84ccs88kc4`

---

## Stack technologiczny

### Backend
| Technologia | Wersja | Rola |
|---|---|---|
| Node.js | 20 (Alpine) | Runtime |
| Express | 4.x | HTTP server |
| Socket.io | 4.8 | WebSocket (real-time) |
| better-sqlite3 | 11.x | Baza danych (plikowa) |
| bcrypt | 6.x | Hashowanie haseł |
| jsonwebtoken | 9.x | JWT auth |
| undici | 7.x | HTTP client (Notion, force IPv4) |
| TypeScript | 5.7 | Język |
| tsx | 4.x | Dev runner (watch mode) |

### Frontend
| Technologia | Wersja | Rola |
|---|---|---|
| React | 18.3 | UI framework |
| Vite | 6.x | Bundler / dev server |
| React Router | 7.x | Routing (SPA) |
| Tailwind CSS | 3.4 | Stylowanie |
| Socket.io-client | 4.8 | WebSocket client |
| Radix UI | - | Slot component (headless UI) |
| class-variance-authority | 0.7 | Warianty komponentów (cn/cva) |
| Playwright | 1.57 | E2E testy (devDep) |

### Infrastruktura
| Element | Szczegóły |
|---|---|
| Docker Compose | v3.8, 2 serwisy + volume + network |
| Nginx | Alpine, reverse proxy (frontend → backend) |
| Traefik | Coolify proxy, SSL (Let's Encrypt) |
| SQLite | Volume: `activity-data` → `/app/data/activity.db` |
| Coolify | Deploy z GitHub, Docker Compose mode |

---

## Architektura systemu

```
┌─────────────────────────────────────────────────────────┐
│                    Traefik (Coolify)                      │
│              monitor.important.is :443                    │
└──────────────────────┬──────────────────────────────────┘
                       │ port 80
┌──────────────────────▼──────────────────────────────────┐
│                  Frontend (nginx:alpine)                  │
│                                                          │
│  /              → React SPA (static files)               │
│  /api/*         → proxy_pass http://backend:3001         │
│  /auth/*        → proxy_pass http://backend:3001         │
│  /admin/*       → proxy_pass http://backend:3001         │
│  /webhook/*     → proxy_pass http://backend:3001         │
│  /socket.io/*   → proxy_pass (WebSocket upgrade)         │
└──────────────────────┬──────────────────────────────────┘
                       │ port 3001
┌──────────────────────▼──────────────────────────────────┐
│              Backend (node:20-alpine)                     │
│                                                          │
│  Express + Socket.io + SQLite                            │
│                                                          │
│  ┌─────────┐  ┌──────────┐  ┌──────────────────────┐    │
│  │ Webhook │  │ Polling  │  │  ClickUp API          │    │
│  │ (push)  │  │ (30s)    │──│  /team/TIME/current   │    │
│  └────┬────┘  └────┬─────┘  │  /task/:id            │    │
│       │            │        │  /time_entries         │    │
│       ▼            ▼        └──────────────────────┘    │
│  ┌─────────────────────┐                                │
│  │   SQLite (activity.db)  │                             │
│  │   + Socket.io emit      │                             │
│  └─────────────────────┘                                │
│       │                                                  │
│       ▼                                                  │
│  ┌──────────────────────┐                                │
│  │   Notion API          │                               │
│  │   (workers, projects) │                               │
│  └──────────────────────┘                                │
└──────────────────────────────────────────────────────────┘
```

---

## Baza danych (SQLite)

### Tabela: `users` — Użytkownicy ClickUp
| Kolumna | Typ | Opis |
|---|---|---|
| id | TEXT PK | ClickUp user ID |
| username | TEXT | Nazwa użytkownika |
| email | TEXT | Email |
| color | TEXT | Kolor awatara |
| profile_picture | TEXT | URL zdjęcia |
| created_at | DATETIME | |
| updated_at | DATETIME | |

### Tabela: `tasks` — Zadania ClickUp
| Kolumna | Typ | Opis |
|---|---|---|
| id | TEXT PK | ClickUp task ID |
| name | TEXT | Nazwa zadania |
| status | TEXT | Status |
| list_id / list_name | TEXT | Lista |
| folder_id / folder_name | TEXT | Folder |
| space_id / space_name | TEXT | Przestrzeń |
| url | TEXT | Link do zadania |

### Tabela: `time_entries` — Wpisy czasu (główna tabela)
| Kolumna | Typ | Opis |
|---|---|---|
| id | TEXT PK | ClickUp time entry ID |
| task_id | TEXT | FK → tasks |
| task_name | TEXT | Denormalizowana nazwa |
| user_id | TEXT | FK → users |
| user_name / user_email | TEXT | Denormalizowane |
| start_time | DATETIME | Początek |
| end_time | DATETIME | Koniec (NULL = aktywny timer) |
| duration | INTEGER | Czas trwania (ms) |
| billable | INTEGER | Czy billable |
| description | TEXT | Opis |
| space_name / folder_name / list_name | TEXT | Lokalizacja w ClickUp |
| task_url | TEXT | Link do zadania |

**Indeksy:** user_id, task_id, start_time, end_time

### Tabela: `app_users` — Użytkownicy aplikacji (auth)
| Kolumna | Typ | Opis |
|---|---|---|
| id | INTEGER PK AUTO | |
| username | TEXT UNIQUE | Login |
| password_hash | TEXT | bcrypt hash |
| role | TEXT | `admin` / `pm` / `user` |
| display_name | TEXT | |
| clickup_user_id | TEXT | Powiązanie z ClickUp |
| is_active | INTEGER | Soft delete (0/1) |
| last_login | DATETIME | |

### Tabela: `notion_workers` — Cache pracowników z Notion
| Kolumna | Typ | Opis |
|---|---|---|
| id | INTEGER PK AUTO | |
| notion_page_id | TEXT UNIQUE | ID strony Notion |
| clickup_user_id | TEXT | Powiązanie z ClickUp |
| name | TEXT | Imię |
| hourly_rate | REAL | Stawka godzinowa |
| status | TEXT | Aktywny/Nieaktywny |

### Tabela: `notion_projects` — Cache projektów z Notion
| Kolumna | Typ | Opis |
|---|---|---|
| id | INTEGER PK AUTO | |
| notion_page_id | TEXT UNIQUE | |
| clickup_id | TEXT | Powiązanie z ClickUp (space/folder/list) |
| name | TEXT | Nazwa projektu |
| hourly_rate | REAL | Stawka godzinowa projektu |
| monthly_budget | REAL | Budżet miesięczny |
| is_internal | INTEGER | 0 = kliencki, 1 = wewnętrzny |

### Tabela: `app_settings` — Konfiguracja runtime
| Kolumna | Typ | Opis |
|---|---|---|
| key | TEXT PK | Nazwa ustawienia |
| value | TEXT | Wartość |
| description | TEXT | Opis |
| is_secret | INTEGER | Czy maskować w UI |

**Hierarchia konfiguracji:** DB (app_settings) → .env → default

---

## System autoryzacji

### Role
| Rola | Widzi | Może |
|---|---|---|
| **admin** | Wszystko | Zarządzanie użytkownikami, ustawieniami, import, Notion sync |
| **pm** | Wszystko | Podgląd dashboardu i earnings jak admin |
| **user** | Tylko swoje dane | Podgląd własnych sesji i zarobków |

### Flow logowania
1. `POST /auth/login` → username + password
2. Backend: bcrypt verify → JWT sign (7 dni ważności)
3. Frontend: token w localStorage, `Authorization: Bearer <token>` w każdym requeście
4. WebSocket: token w `handshake.auth.token`

### Middleware chain
```
requireAuth → weryfikuje JWT, dodaje req.user (JWTPayload)
requireRole('admin') → sprawdza role w req.user
getScope(req) → zwraca { appUser, isAdmin, isPm, isUser, clickupUserId }
```

### Scope (filtrowanie danych)
- **admin/pm** → widzi dane wszystkich użytkowników
- **user** → dane filtrowane po `clickup_user_id` (musi być powiązany)

---

## API Endpoints

### Publiczne (bez auth)
| Metoda | Ścieżka | Opis |
|---|---|---|
| POST | `/webhook/clickup` | Webhook ClickUp (taskTimeTrackedUpdated) |
| POST | `/auth/login` | Logowanie |
| GET | `/health` | Health check |

### Wymagające auth (requireAuth)
| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/auth/me` | Dane zalogowanego użytkownika |
| POST | `/auth/change-password` | Zmiana hasła |
| GET | `/api/active` | Aktywne sesje (end_time IS NULL) |
| GET | `/api/history` | Historia z paginacją (?limit, ?offset, ?start, ?end) |
| GET | `/api/history/filtered` | Historia z filtrem po user_id |
| GET | `/api/users` | Lista użytkowników ClickUp |
| GET | `/api/stats/today` | Statystyki dzisiejsze |
| GET | `/api/stats/team` | Statystyki zespołu (?period / ?start+?end) |
| GET | `/api/user/:userId/stats` | Statystyki konkretnego użytkownika |

### Home (dashboard nowy)
| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/home/summary` | Podsumowanie: total hours, earnings, tasks list |
| GET | `/api/home/task-entries` | Szczegółowe wpisy dla taska (?task_id) |

### Earnings (zarobki)
| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/earnings/summary` | Podsumowanie zarobków |
| GET | `/api/earnings/by-user` | Zarobki per użytkownik |
| GET | `/api/earnings/by-project` | Zarobki per projekt |
| GET | `/api/earnings/details` | Szczegółowe wpisy zarobków |
| GET | `/api/earnings/unmapped` | Wpisy bez mapowania projektu (admin) |
| POST | `/api/earnings/backfill-tasks` | Uzupełnij brakujące taski z ClickUp (admin) |
| POST | `/api/earnings/import-time-entries` | Import wpisów z ClickUp API (admin) |

### Notion (admin only)
| Metoda | Ścieżka | Opis |
|---|---|---|
| POST | `/api/notion/sync/workers` | Sync pracowników z Notion |
| POST | `/api/notion/sync/projects` | Sync projektów z Notion |
| GET | `/api/notion/workers` | Lista pracowników (cache) |
| GET | `/api/notion/projects` | Lista projektów (cache) |

### Admin (admin only)
| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/admin/users` | Lista użytkowników aplikacji |
| POST | `/admin/users` | Utwórz użytkownika |
| GET | `/admin/users/:id` | Szczegóły użytkownika |
| PUT | `/admin/users/:id` | Edycja użytkownika |
| DELETE | `/admin/users/:id` | Dezaktywacja (soft delete) |
| POST | `/admin/users/:id/reset-password` | Reset hasła |
| POST | `/admin/fix-durations` | Napraw wpisy z duration=0 |
| GET | `/admin/settings` | Lista ustawień |
| PUT | `/admin/settings/:key` | Zmień ustawienie |
| DELETE | `/admin/settings/:key` | Usuń ustawienie (powrót do .env) |
| POST | `/admin/settings/test-clickup` | Test połączenia z ClickUp |
| POST | `/admin/settings/test-notion` | Test połączenia z Notion |
| GET | `/admin/projects` | Lista projektów (is_internal) |
| PATCH | `/admin/projects/:id/internal` | Toggle is_internal |

---

## WebSocket Events

| Event | Kierunek | Opis |
|---|---|---|
| `active_sessions` | Server → Client | Po połączeniu: lista aktywnych sesji |
| `time_entry_started` | Server → Client | Ktoś zaczął tracking |
| `time_entry_stopped` | Server → Client | Ktoś zakończył tracking |
| `time_entry_updated` | Server → Client | Aktualizacja sesji |

**Scoped delivery:** admin/pm dostaje wszystko, user dostaje tylko swoje eventy (filtrowane po clickup_user_id).

---

## Mechanizmy pobierania danych

### 1. Webhook (push, real-time)
- ClickUp wysyła POST na `/webhook/clickup` przy zdarzeniu `taskTimeTrackedUpdated`
- Payload zawiera `history_items` z before/after time entry
- Obsługuje: start, stop, edycję czasu

### 2. Polling (pull, co 30s)
- Backend odpytuje ClickUp API: `GET /team/{teamId}/time_entries/current?assignee={userId}`
- Iteruje po wszystkich członkach zespołu
- Cache w pamięci (`activeTimers` Map)
- Przy restarcie: odtwarza cache z bazy (time_entries WHERE end_time IS NULL)
- Wykrywa nowe i zakończone timery (porównanie z cache)
- Fallback: jeśli webhook nie zadziałał, polling uzupełnia end_time i duration

### 3. Import (manual, admin)
- `POST /api/earnings/import-time-entries?start=DATE&end=DATE`
- Pobiera time entries z ClickUp API z paginacją
- Streaming response (Server-Sent Events style)
- Guard: MAX_IMPORT_ENTRIES_PER_USER = 10,000

---

## Integracje zewnętrzne

### ClickUp API v2
| Endpoint | Zastosowanie |
|---|---|
| `GET /team` | Lista zespołów i członków |
| `GET /team/{id}/time_entries/current?assignee={uid}` | Aktywne timery (polling) |
| `GET /team/{id}/time_entries?start_date&end_date` | Import historyczny |
| `GET /task/{id}` | Szczegóły zadania (nazwa, list, folder, space) |

**Team ID:** `4552118` (hardcoded default)
**Auth:** Header `Authorization: {token}` (bez "Bearer")

### Notion API
| Endpoint | Zastosowanie |
|---|---|
| `POST /databases/{id}/query` | Pobieranie pracowników i projektów |
| `GET /users` | Test połączenia |

**Auth:** Header `Authorization: Bearer {token}` + `Notion-Version: 2022-06-28`
**IPv4 forced:** undici Agent z `family: 4` (fix na timeout IPv6)

---

## Frontend — Struktura komponentów

```
App.tsx
├── Login (publiczny)
├── ProtectedRoute (wrapper z auth check)
│   ├── HomeTab — Główny dashboard (summary, tasks, active sessions)
│   ├── EarningsTab — Zarobki (summary, by-user, by-project)
│   ├── TimeEntriesImport — Import wpisów z ClickUp (admin)
│   └── AdminPanel — Panel administracyjny
│       ├── Users management (CRUD)
│       ├── Settings management (ClickUp/Notion config)
│       ├── Projects (is_internal toggle)
│       └── NotionSync
├── DateRangePicker — Wybór zakresu dat (today/week/month/custom)
├── Avatar — Awatar użytkownika
└── components/ui/ — shadcn/ui primitives (Badge, Button, Card)
```

### Auth Context
- `AuthContext.tsx` — React Context z tokenem JWT
- Token w localStorage
- Auto-redirect na `/login` gdy brak/wygasły token
- `useAuth()` hook: `{ token, user, login(), logout() }`

### API Communication
- `VITE_API_URL` (build-time env) — prefix dla fetch URL
- Jeśli pusty → requesty relatywne (nginx proxy)
- WebSocket: `io(API_URL || window.location.origin, { auth: { token } })`

---

## Docker / Deploy

### docker-compose.yaml
```yaml
services:
  backend:
    build: ./backend           # node:20-alpine, port 3001
    volumes: activity-data:/app/data   # SQLite persistence
    healthcheck: wget http://localhost:3001/health

  frontend:
    build: ./frontend          # nginx:alpine, port 80
    depends_on: backend (service_healthy)
    healthcheck: curl http://localhost:80/

volumes:
  activity-data:               # Persystentny volume na SQLite

networks:
  clickup-monitor: bridge
```

### Coolify config
| Parametr | Wartość |
|---|---|
| UUID | `owkkkkgcw000wk84ccs88kc4` |
| Git repo | lukelocksmith/timemonitor |
| Git branch | main |
| Compose location | /docker-compose.yaml |
| Compose parsing | v5 |
| ports_exposes | **80** (ważne! nginx) |
| Domena | monitor.important.is (Traefik → frontend:80) |

### Zmienne środowiskowe (Coolify)
| Zmienna | Wymagana | Opis |
|---|---|---|
| JWT_SECRET | Tak | Secret do JWT (min 32 znaki) |
| ADMIN_USERNAME | Tak | Login admina (seed) |
| ADMIN_PASSWORD | Tak | Hasło admina (seed, ⚠️ nie aktualizuje istniejącego) |
| CLICKUP_API_TOKEN | Tak | Token API ClickUp |
| CLICKUP_TEAM_ID | Nie | ID zespołu (default: 4552118) |
| CLICKUP_WEBHOOK_SECRET | Nie | Secret webhooka |
| FRONTEND_URL | Nie | URL frontendu (CORS) |
| VITE_API_URL | Nie | URL API dla frontendu (build-time) |
| NOTION_API_KEY | Nie | Token Notion |
| NOTION_VERSION | Nie | Wersja API Notion (default: 2022-06-28) |
| NOTION_WORKERS_DB | Nie | Notion database ID pracowników |
| NOTION_PROJECTS_DB | Nie | Notion database ID projektów |

---

## Znane problemy / gotchas

1. **ADMIN_PASSWORD seed** — `seedAdminUser()` tworzy admina tylko jeśli nie istnieje. Zmiana env var nie aktualizuje hasła — trzeba ręcznie w bazie lub usunąć użytkownika.

2. **Coolify ports_exposes** — musi być `80` (nginx), nie `3000`. Traefik kieruje ruch na ten port.

3. **MAX_ENTRY_DURATION_MS** — 12h cap. Wpisy dłuższe niż 12h są ignorowane w zapytaniach i importach. Chroni przed zapomnianymi timerami.

4. **Polling vs Webhook** — dual delivery. Polling (co 30s) jest fallbackiem gdyby webhook nie zadziałał. Może powodować duplikaty eventów WebSocket, ale baza jest idempotentna (INSERT ON CONFLICT UPDATE).

5. **Notion IPv4** — undici Agent z `family: 4` bo IPv6 timeout na serwerze.

6. **VITE_API_URL** — jest BUILD-TIME (baked in JS). Zmiana wymaga przebudowania frontendu. Jeśli pusty, frontend robi requesty relatywne (przez nginx proxy), co jest preferowane na produkcji.
