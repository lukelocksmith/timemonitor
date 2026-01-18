# ClickUp Activity Monitor - Dokumentacja

## Spis treści

1. [Opis aplikacji](#1-opis-aplikacji)
2. [Architektura](#2-architektura)
3. [Struktura projektu](#3-struktura-projektu)
4. [Backend - szczegóły](#4-backend---szczegóły)
5. [Frontend - szczegóły](#5-frontend---szczegóły)
6. [Baza danych](#6-baza-danych)
7. [Integracja z ClickUp](#7-integracja-z-clickup)
8. [Uruchomienie projektu](#8-uruchomienie-projektu)
9. [API Reference](#9-api-reference)
10. [WebSocket Events](#10-websocket-events)
11. [Rozszerzanie aplikacji](#11-rozszerzanie-aplikacji)

---

## 1. Opis aplikacji

**ClickUp Activity Monitor** to aplikacja do śledzenia w czasie rzeczywistym kto pracuje nad czym w ClickUp.

### Co robi aplikacja?

```
┌────────────────────┐
│     ClickUp        │  Użytkownik włącza time tracking
│  (Time Tracking)   │
└─────────┬──────────┘
          │
          ▼ Webhook + Polling
┌────────────────────┐
│      Backend       │  Odbiera zdarzenia, zapisuje do bazy
│   (Express.js)     │
└─────────┬──────────┘
          │
          ▼ WebSocket (Socket.io)
┌────────────────────┐
│     Frontend       │  Pokazuje kto teraz pracuje
│     (React)        │
└────────────────────┘
```

### Główne funkcje

| Funkcja | Opis |
|---------|------|
| **Live Activity** | Widok w czasie rzeczywistym kto pracuje |
| **Historia** | Zakończone wpisy czasu |
| **Statystyki** | Podsumowanie per osoba/okres |
| **Autoryzacja** | Logowanie z rolami admin/user |
| **Admin Panel** | Zarządzanie użytkownikami aplikacji |

---

## 2. Architektura

### Diagram przepływu danych

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLICKUP                                  │
│  ┌──────────────┐                      ┌───────────────────┐    │
│  │ User starts  │                      │   ClickUp API     │    │
│  │ time tracker │                      │ (time_entries)    │    │
│  └──────┬───────┘                      └─────────┬─────────┘    │
└─────────┼────────────────────────────────────────┼──────────────┘
          │                                        │
          │ Webhook Event                          │ Polling (30s)
          ▼                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                         BACKEND                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────────┐  │
│  │   webhook.ts │    │  polling.ts  │    │   SQLite (baza)   │  │
│  │ POST /webhook│    │  co 30 sek   │───▶│ - time_entries    │  │
│  └──────┬───────┘    └──────┬───────┘    │ - users           │  │
│         │                   │            │ - tasks           │  │
│         └─────────┬─────────┘            │ - app_users       │  │
│                   │                      └───────────────────┘  │
│                   ▼                                              │
│           ┌──────────────┐                                       │
│           │  Socket.io   │  Emituje eventy do klientów           │
│           └──────┬───────┘                                       │
└──────────────────┼──────────────────────────────────────────────┘
                   │
                   │ WebSocket
                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     React App                             │   │
│  │  ┌─────────┐  ┌────────────┐  ┌─────────────────────┐    │   │
│  │  │ Login   │  │ Dashboard  │  │ Admin Panel         │    │   │
│  │  │ /login  │  │ / (live)   │  │ /admin (tylko admin)│    │   │
│  │  └─────────┘  └────────────┘  └─────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Technologie

| Warstwa | Technologia | Wersja |
|---------|-------------|--------|
| **Backend** | Node.js + Express | Express 4.21 |
| **Realtime** | Socket.io | 4.8 |
| **Baza danych** | SQLite (better-sqlite3) | 11.7 |
| **Auth** | JWT + bcrypt | JWT 9.0, bcrypt 6.0 |
| **Frontend** | React + Vite | React 18.3, Vite 6.0 |
| **Styling** | Tailwind CSS | 3.4 |
| **Routing** | React Router | 7.12 |
| **TypeScript** | Wspólny dla backend i frontend | 5.7 |

---

## 3. Struktura projektu

```
clickup-activity-monitor/
│
├── backend/                      # Serwer Express.js
│   ├── src/
│   │   ├── auth/                 # System autoryzacji
│   │   │   ├── jwt.ts           # Generowanie/weryfikacja tokenów
│   │   │   ├── middleware.ts    # requireAuth, requireRole
│   │   │   └── password.ts      # Hashowanie haseł (bcrypt)
│   │   │
│   │   ├── routes/               # Endpointy HTTP
│   │   │   ├── api.ts           # /api/* - dane (chronione)
│   │   │   ├── auth.ts          # /auth/* - logowanie
│   │   │   ├── admin.ts         # /admin/* - CRUD użytkowników
│   │   │   └── webhook.ts       # /webhook/* - ClickUp webhooks
│   │   │
│   │   ├── types/                # Definicje TypeScript
│   │   │   └── auth.ts          # Interfejsy dla auth
│   │   │
│   │   ├── database.ts          # Połączenie SQLite + funkcje
│   │   ├── polling.ts           # Odpytywanie ClickUp API
│   │   └── index.ts             # Punkt startowy serwera
│   │
│   ├── data/                     # Folder na bazę SQLite
│   │   └── activity.db          # Baza danych (generowana)
│   │
│   ├── .env                      # Zmienne środowiskowe
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                     # Aplikacja React
│   ├── src/
│   │   ├── components/           # Komponenty React
│   │   │   ├── AdminPanel.tsx   # Panel zarządzania userami
│   │   │   ├── Login.tsx        # Formularz logowania
│   │   │   └── ProtectedRoute.tsx # Guard dla routingu
│   │   │
│   │   ├── contexts/             # React Contexts
│   │   │   └── AuthContext.tsx  # Stan autoryzacji
│   │   │
│   │   ├── App.tsx              # Główny komponent + routing
│   │   ├── main.tsx             # Punkt startowy
│   │   ├── index.css            # Style Tailwind
│   │   └── vite-env.d.ts        # Typy dla Vite
│   │
│   ├── .env                      # VITE_API_URL
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── tsconfig.json
│
└── docs/                         # Dokumentacja
    ├── README.md                 # Ten plik
    ├── AUTH-SYSTEM.md           # Szczegóły autoryzacji
    └── PLAN-EARNINGS-FEATURE.md # Plan przyszłej funkcji
```

---

## 4. Backend - szczegóły

### 4.1 Punkt startowy (`index.ts`)

```typescript
// Kolejność inicjalizacji:
1. Ładowanie zmiennych (.env)
2. Tworzenie serwera Express + HTTP
3. Konfiguracja Socket.io z CORS
4. Middleware WebSocket auth (weryfikacja JWT)
5. Middleware Express (CORS, JSON parser)
6. Rejestracja routów:
   - /webhook (publiczny - ClickUp)
   - /auth (publiczny - logowanie)
   - /api (chroniony - dane)
   - /admin (chroniony - tylko admin)
7. Inicjalizacja bazy danych
8. Start serwera HTTP
9. Start pollingu ClickUp API
```

### 4.2 System autoryzacji

Szczegóły w pliku: `docs/AUTH-SYSTEM.md`

**Krótko:**
- JWT token z payloadem: `{ userId, username, role }`
- Ważność: 7 dni
- Role: `admin` | `user`
- Middleware: `requireAuth`, `requireRole('admin')`

### 4.3 Webhook (`webhook.ts`)

**Co robi:**
1. Odbiera POST z ClickUp gdy ktoś startuje/stopuje timer
2. Parsuje payload `taskTimeTrackedUpdated`
3. Zapisuje/aktualizuje `time_entries` w bazie
4. Emituje event przez Socket.io do wszystkich klientów

**Payload z ClickUp:**
```typescript
{
  event: "taskTimeTrackedUpdated",
  task_id: "abc123",
  history_items: [{
    user: { id, username, email, color },
    before: { id, start, end, time } | null,  // poprzedni stan
    after: { id, start, end, time }           // nowy stan
  }]
}
```

**Logika:**
- `after` istnieje, `before` = null → **nowy wpis** (START lub zakończony)
- `after` i `before` istnieją → **aktualizacja** (STOP lub edycja)

### 4.4 Polling (`polling.ts`)

**Po co?**
Webhook nie zawsze działa natychmiast. Polling co 30s odpytuje ClickUp API i wykrywa nowe/zakończone timery.

**Jak działa:**
1. Pobiera listę członków zespołu
2. Dla każdego sprawdza `GET /team/{id}/time_entries/current?assignee={userId}`
3. Porównuje z poprzednim stanem (cache `activeTimers`)
4. Nowe timery → emituje `time_entry_started`
5. Zniknięte timery → emituje `time_entry_stopped`

### 4.5 API Routes (`api.ts`)

| Endpoint | Opis |
|----------|------|
| `GET /api/active` | Aktywne sesje (kto teraz pracuje) |
| `GET /api/history` | Zakończone wpisy (limit, offset) |
| `GET /api/history/filtered` | Historia z filtrem po user_id |
| `GET /api/users` | Lista użytkowników ClickUp |
| `GET /api/user/:userId/stats` | Statystyki jednego usera |
| `GET /api/stats/today` | Statystyki dzisiejsze |
| `GET /api/stats/team` | Statystyki zespołu (period: today/week/month) |

---

## 5. Frontend - szczegóły

### 5.1 Struktura komponentów

```
App.tsx
├── Routes
│   ├── /login → Login.tsx
│   ├── / → ProtectedRoute → Dashboard
│   │                         ├── Header (logo, user, logout)
│   │                         ├── Tabs (Live | Statystyki)
│   │                         ├── LiveTab
│   │                         │   ├── Filtr po osobie
│   │                         │   ├── ActiveSession[] (kto pracuje)
│   │                         │   └── HistoryEntry[] (ostatnia aktywność)
│   │                         └── StatsTab
│   │                             ├── Wybór okresu (today/week/month)
│   │                             ├── Karty podsumowania
│   │                             └── Tabela per osoba
│   │
│   └── /admin → ProtectedRoute(requireAdmin) → AdminPage
│                                                └── AdminPanel.tsx
│                                                    ├── Lista użytkowników
│                                                    └── Formularz dodawania
```

### 5.2 AuthContext

```typescript
// Dostarcza:
const {
  user,           // { id, username, role, display_name } | null
  token,          // JWT string | null
  isAuthenticated,// boolean
  isAdmin,        // boolean (role === 'admin')
  isLoading,      // boolean (sprawdzanie tokena)
  login,          // (username, password) => Promise
  logout,         // () => void
} = useAuth();
```

### 5.3 Socket.io w React

```typescript
// W Dashboard:
useEffect(() => {
  const socket = io(API_URL, {
    auth: { token }  // JWT do autoryzacji
  });

  socket.on('active_sessions', (sessions) => { ... });
  socket.on('time_entry_started', (entry) => { ... });
  socket.on('time_entry_stopped', (data) => { ... });

  return () => socket.close();
}, [token]);
```

### 5.4 Kluczowe komponenty

**ActiveSession** - Karta aktywnego timera
```
┌─────────────────────────────────────────┐
│ 🟢 [Avatar] Jan Kowalski    Aktywny     │
│     Nazwa zadania (link do ClickUp)     │
│                               2h 15m    │
│                               od 09:30  │
└─────────────────────────────────────────┘
```

**StatsTab** - Tabela statystyk
```
┌────────────────────────────────────────────────┐
│ [Dzisiaj] [Ten tydzień] [Ten miesiąc]          │
├────────────────────────────────────────────────┤
│ Łączny czas: 24h 30min  │ Osób: 5 │ Wpisów: 47│
├────────────────────────────────────────────────┤
│ Osoba          │ Czas      │ Wpisy │ Zadania  │
│ Jan Kowalski   │ 8h 15min  │ 12    │ 5        │
│ Anna Nowak     │ 6h 30min  │ 8     │ 3        │
└────────────────────────────────────────────────┘
```

---

## 6. Baza danych

### Schemat SQLite

```sql
-- Użytkownicy ClickUp (z API)
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- ClickUp user ID
  username TEXT,
  email TEXT,
  color TEXT,                    -- Kolor awatara
  profile_picture TEXT,          -- URL zdjęcia
  created_at DATETIME,
  updated_at DATETIME
);

-- Zadania ClickUp
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,           -- ClickUp task ID
  name TEXT,
  status TEXT,
  list_id TEXT,                  -- ID listy w ClickUp
  list_name TEXT,
  folder_id TEXT,
  folder_name TEXT,
  space_id TEXT,
  space_name TEXT,
  url TEXT,
  created_at DATETIME,
  updated_at DATETIME
);

-- Wpisy czasu (najważniejsza tabela!)
CREATE TABLE time_entries (
  id TEXT PRIMARY KEY,           -- ClickUp time entry ID
  task_id TEXT,                  -- Powiązanie z tasks
  task_name TEXT,                -- Nazwa zadania (denormalizacja)
  user_id TEXT,                  -- Powiązanie z users
  user_name TEXT,                -- Username (denormalizacja)
  user_email TEXT,
  start_time DATETIME,           -- Kiedy zaczął
  end_time DATETIME,             -- Kiedy skończył (NULL = aktywny!)
  duration INTEGER,              -- Czas w ms
  billable INTEGER DEFAULT 0,
  description TEXT,
  space_name TEXT,
  folder_name TEXT,
  list_name TEXT,
  task_url TEXT,
  created_at DATETIME
);

-- Użytkownicy aplikacji (auth)
CREATE TABLE app_users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,   -- bcrypt hash
  role TEXT DEFAULT 'user',      -- 'admin' | 'user'
  display_name TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME,
  last_login DATETIME
);
```

### Indeksy

```sql
CREATE INDEX idx_time_entries_user ON time_entries(user_id);
CREATE INDEX idx_time_entries_task ON time_entries(task_id);
CREATE INDEX idx_time_entries_start ON time_entries(start_time);
CREATE INDEX idx_time_entries_end ON time_entries(end_time);
CREATE INDEX idx_app_users_username ON app_users(username);
```

### Przykładowe zapytania

```sql
-- Kto teraz pracuje?
SELECT * FROM time_entries WHERE end_time IS NULL;

-- Ile czasu przepracował user w tym tygodniu?
SELECT SUM(duration) as total
FROM time_entries
WHERE user_id = '123'
  AND start_time >= date('now', 'weekday 0', '-7 days')
  AND end_time IS NOT NULL;

-- Top 10 zadań usera
SELECT task_name, SUM(duration) as total
FROM time_entries
WHERE user_id = '123'
GROUP BY task_id
ORDER BY total DESC
LIMIT 10;
```

---

## 7. Integracja z ClickUp

### 7.1 Wymagane dane

```bash
# W .env:
CLICKUP_API_TOKEN=pk_xxx        # Personal API Token
CLICKUP_WEBHOOK_SECRET=xxx      # Secret z webhoo ka (opcjonalne)
```

### 7.2 Jak uzyskać API Token?

1. Zaloguj się do ClickUp
2. Kliknij avatar → Settings
3. Apps → Generate API Token
4. Skopiuj token do `.env`

### 7.3 Jak skonfigurować Webhook?

1. ClickUp → Settings → Integrations → Webhooks
2. Create Webhook:
   - **URL:** `https://twoja-domena.com/webhook/clickup`
   - **Events:** `taskTimeTrackedUpdated`
3. Zapisz Secret do `.env` (opcjonalne - do weryfikacji)

### 7.4 Team ID

W pliku `polling.ts` jest hardcoded `TEAM_ID = '4552118'`.

Jak znaleźć swój Team ID:
```bash
curl -H "Authorization: pk_xxx" https://api.clickup.com/api/v2/team
```

---

## 8. Uruchomienie projektu

### 8.1 Wymagania

- Node.js 18+
- npm lub yarn

### 8.2 Instalacja

```bash
# Sklonuj repo
git clone <repo-url>
cd clickup-activity-monitor

# Backend
cd backend
npm install
cp .env.example .env  # Uzupełnij zmienne

# Frontend
cd ../frontend
npm install
cp .env.example .env  # Ustaw VITE_API_URL
```

### 8.3 Konfiguracja `.env`

**Backend (`.env`):**
```bash
PORT=3001
CLICKUP_API_TOKEN=pk_xxx
CLICKUP_WEBHOOK_SECRET=xxx
JWT_SECRET=min-32-znaki-losowy-string
ADMIN_USERNAME=admin
ADMIN_PASSWORD=twoje-haslo
FRONTEND_URL=http://localhost:5173
```

**Frontend (`.env`):**
```bash
VITE_API_URL=http://localhost:3001
```

### 8.4 Uruchomienie (development)

```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
```

### 8.5 Uruchomienie (production)

```bash
# Backend
cd backend
npm run build
npm start

# Frontend
cd frontend
npm run build
# Serwuj dist/ przez nginx lub inny serwer
```

---

## 9. API Reference

### Endpointy publiczne

| Metoda | Endpoint | Body | Opis |
|--------|----------|------|------|
| POST | `/auth/login` | `{username, password}` | Logowanie |
| POST | `/webhook/clickup` | ClickUp payload | Webhook |
| GET | `/health` | - | Health check |

### Endpointy chronione (wymagają `Authorization: Bearer <token>`)

| Metoda | Endpoint | Query | Opis |
|--------|----------|-------|------|
| GET | `/auth/me` | - | Dane zalogowanego |
| POST | `/auth/change-password` | - | Zmiana hasła |
| GET | `/api/active` | - | Aktywne sesje |
| GET | `/api/history` | `limit, offset` | Historia |
| GET | `/api/history/filtered` | `limit, offset, user_id` | Historia filtrowana |
| GET | `/api/users` | - | Lista userów ClickUp |
| GET | `/api/user/:id/stats` | `days` | Statystyki usera |
| GET | `/api/stats/today` | - | Statystyki dnia |
| GET | `/api/stats/team` | `period` | Statystyki zespołu |

### Endpointy admin (wymagają roli `admin`)

| Metoda | Endpoint | Body | Opis |
|--------|----------|------|------|
| GET | `/admin/users` | - | Lista użytkowników app |
| POST | `/admin/users` | `{username, password, role, display_name}` | Nowy user |
| PUT | `/admin/users/:id` | `{display_name, role, is_active}` | Edycja |
| DELETE | `/admin/users/:id` | - | Dezaktywacja |

---

## 10. WebSocket Events

### Połączenie

```typescript
const socket = io('http://localhost:3001', {
  auth: { token: 'JWT_TOKEN' }
});
```

### Events od serwera

| Event | Payload | Kiedy |
|-------|---------|-------|
| `active_sessions` | `TimeEntry[]` | Po połączeniu + co 30s |
| `time_entry_started` | `TimeEntry` | Ktoś zaczął tracking |
| `time_entry_stopped` | `Partial<TimeEntry>` | Ktoś skończył |
| `time_entry_updated` | `Partial<TimeEntry>` | Edycja wpisu |

### Struktura TimeEntry

```typescript
interface TimeEntry {
  id: string;
  task_id: string;
  task_name: string;
  task_url: string;
  user_id: string;
  user_name: string;
  user_email?: string;
  user_color?: string;
  user_avatar?: string;
  start_time: string;      // ISO date
  end_time?: string;       // ISO date (null = aktywny)
  duration?: number;       // ms
}
```

---

## 11. Rozszerzanie aplikacji

### Dodanie nowego endpointu API

1. Otwórz `backend/src/routes/api.ts`
2. Dodaj nowy endpoint:
   ```typescript
   apiRouter.get('/nowy-endpoint', (req, res) => {
     // Logika
     res.json({ data: 'test' });
   });
   ```
3. Endpoint automatycznie wymaga autoryzacji (middleware na routerze)

### Dodanie nowego WebSocket event

1. W `backend/src/index.ts` lub odpowiednim pliku:
   ```typescript
   io.emit('nazwa_eventu', { dane: 'wartość' });
   ```

2. W `frontend/src/App.tsx`:
   ```typescript
   socket.on('nazwa_eventu', (data) => {
     console.log(data);
   });
   ```

### Dodanie nowej roli

1. Zmień constraint w `database.ts`:
   ```sql
   CHECK(role IN ('admin', 'user', 'nowa_rola'))
   ```

2. Dodaj do typu w `types/auth.ts`:
   ```typescript
   export type UserRole = 'admin' | 'user' | 'nowa_rola';
   ```

3. Użyj w middleware:
   ```typescript
   router.get('/endpoint', requireAuth, requireRole('nowa_rola'), handler);
   ```

### Dodanie nowej zakładki w UI

1. W `frontend/src/App.tsx`:
   ```typescript
   // W Dashboard, dodaj do state:
   const [activeTab, setActiveTab] = useState<'live' | 'stats' | 'nowa'>('live');

   // Dodaj button w tabs:
   <button onClick={() => setActiveTab('nowa')}>Nowa zakładka</button>

   // Dodaj renderowanie:
   {activeTab === 'nowa' && <NowaZakladka />}
   ```

2. Utwórz komponent `NowaZakladka.tsx`

---

## Przydatne linki

- [ClickUp API Docs](https://clickup.com/api)
- [Socket.io Docs](https://socket.io/docs/v4/)
- [React Router Docs](https://reactrouter.com/)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)

---

*Dokumentacja wygenerowana: Styczeń 2025*
