# ClickUp Activity Monitor

Real-time dashboard pokazujący kto aktualnie pracuje nad jakim zadaniem w ClickUp.

![Dashboard Preview](docs/preview.png)

## Funkcje

- **Live tracking** - widzisz w czasie rzeczywistym kto włączył time tracking
- **Historia aktywności** - ostatnie sesje pracy
- **WebSocket** - natychmiastowe aktualizacje bez odświeżania
- **Docker ready** - łatwy deploy na Coolify/własny serwer

## Wymagania

- ClickUp workspace (dowolny plan z time tracking)
- Docker + Docker Compose (do deploymentu)
- Node.js 20+ (do lokalnego developmentu)

---

## Szybki start (lokalnie)

### 1. Zainstaluj zależności

```bash
# Backend
cd backend
npm install
cp .env.example .env

# Frontend
cd ../frontend
npm install
```

### 2. Uruchom aplikację

```bash
# Terminal 1 - Backend
cd backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
```

Aplikacja będzie dostępna na: http://localhost:5173

---

## Deploy z Docker (Coolify)

### 1. Zbuduj i uruchom

```bash
cp .env.example .env
# Edytuj .env i ustaw CLICKUP_WEBHOOK_SECRET

docker compose up -d --build
```

Aplikacja będzie dostępna na porcie 8080 (lub innym ustawionym w .env).

### 2. W Coolify

1. Dodaj nowy projekt "Docker Compose"
2. Wskaż repozytorium z tym kodem
3. Ustaw zmienne środowiskowe (CLICKUP_WEBHOOK_SECRET)
4. Deploy!

---

## Konfiguracja Webhooków w ClickUp

To jest **najważniejszy krok** - bez webhooków aplikacja nie otrzyma danych.

### Metoda 1: Przez ClickUp API (zalecana)

#### Krok 1: Pobierz API Token

1. Idź do ClickUp → Settings → Apps
2. Kliknij "Generate" przy API Token
3. Skopiuj token

#### Krok 2: Znajdź Team ID

```bash
curl -X GET "https://api.clickup.com/api/v2/team" \
  -H "Authorization: TWOJ_API_TOKEN"
```

Zapisz `id` z odpowiedzi.

#### Krok 3: Utwórz Webhook

```bash
curl -X POST "https://api.clickup.com/api/v2/team/TEAM_ID/webhook" \
  -H "Authorization: TWOJ_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "endpoint": "https://twoja-domena.pl/webhook/clickup",
    "events": [
      "timeEntryStarted",
      "timeEntryStopped",
      "timeEntryDeleted",
      "timeEntryUpdated"
    ]
  }'
```

**Odpowiedź zawiera `secret`** - zapisz go i dodaj do `.env` jako `CLICKUP_WEBHOOK_SECRET`.

### Metoda 2: Przez Automations (prostsza, mniej elastyczna)

1. W ClickUp idź do Automations
2. Utwórz nową automatyzację:
   - **Trigger**: "When time is tracked"
   - **Action**: "Call webhook"
   - **URL**: `https://twoja-domena.pl/webhook/clickup`

⚠️ Ta metoda nie daje pełnych danych o time entry - metoda API jest lepsza.

---

## Testowanie webhooków lokalnie

Do testów lokalnych użyj [ngrok](https://ngrok.com/) lub [localtunnel](https://localtunnel.me/):

```bash
# Zainstaluj ngrok
brew install ngrok  # lub pobierz z ngrok.com

# Uruchom tunel
ngrok http 3001

# Użyj URL z ngrok (np. https://abc123.ngrok.io) przy tworzeniu webhooka
```

---

## Struktura projektu

```
clickup-activity-monitor/
├── backend/
│   ├── src/
│   │   ├── index.ts          # Główny serwer Express + Socket.io
│   │   ├── database.ts       # SQLite setup
│   │   └── routes/
│   │       ├── webhook.ts    # Odbieranie webhooków z ClickUp
│   │       └── api.ts        # REST API dla frontendu
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # Główny komponent dashboardu
│   │   └── main.tsx
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml
└── README.md
```

---

## API Endpoints

### Webhooks

- `POST /webhook/clickup` - Endpoint dla webhooków ClickUp

### REST API

- `GET /api/active` - Aktywne sesje (kto teraz pracuje)
- `GET /api/history?limit=50` - Historia sesji
- `GET /api/users` - Lista użytkowników
- `GET /api/stats/today` - Dzisiejsze statystyki
- `GET /api/user/:id/stats?days=7` - Statystyki użytkownika

### WebSocket Events

- `active_sessions` - Wysyłane po połączeniu (aktualne sesje)
- `time_entry_started` - Ktoś zaczął tracking
- `time_entry_stopped` - Ktoś zakończył tracking
- `time_entry_updated` - Aktualizacja sesji

---

## Troubleshooting

### Webhooks nie działają

1. Sprawdź czy URL jest publicznie dostępny (nie localhost)
2. Sprawdź logi: `docker compose logs -f backend`
3. Zweryfikuj czy webhook został utworzony:
   ```bash
   curl -X GET "https://api.clickup.com/api/v2/team/TEAM_ID/webhook" \
     -H "Authorization: TWOJ_API_TOKEN"
   ```

### Brak danych na dashboardzie

1. Upewnij się że ktoś włączył time tracking w ClickUp
2. Sprawdź połączenie WebSocket (zielona kropka w headerze)
3. Sprawdź logi backendu

### SQLite błędy

Upewnij się że volume `activity-data` ma prawidłowe uprawnienia:
```bash
docker compose exec backend ls -la /app/data
```

---

## Licencja

MIT
