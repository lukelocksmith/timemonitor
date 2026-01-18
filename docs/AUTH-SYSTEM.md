# Dokumentacja: System Autoryzacji

## Podsumowanie

System JWT z rolami `admin` i `user` dla ClickUp Activity Monitor.

- **Admin**: pełny dostęp, zarządzanie użytkownikami, dane finansowe
- **User**: widzi aktywność, BEZ danych finansowych

---

## 1. Architektura

```
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│   Frontend  │ ──── │   Backend   │ ──── │   SQLite    │
│  (React)    │ JWT  │  (Express)  │      │ app_users   │
└─────────────┘      └─────────────┘      └─────────────┘
       │                    │
       │                    ▼
       │              ┌─────────────┐
       └───────────── │  Socket.io  │
            JWT       │  (auth)     │
                      └─────────────┘
```

---

## 2. Struktura Plików

### Backend
```
backend/src/
├── auth/
│   ├── jwt.ts           # signToken, verifyToken
│   ├── middleware.ts    # requireAuth, requireRole
│   └── password.ts      # hashPassword, verifyPassword
├── routes/
│   ├── admin.ts         # CRUD użytkowników
│   ├── api.ts           # Chronione endpointy (requireAuth)
│   └── auth.ts          # Login, me, change-password
├── types/
│   └── auth.ts          # Interfejsy TypeScript
└── database.ts          # Tabela app_users, seedAdminUser
```

### Frontend
```
frontend/src/
├── contexts/
│   └── AuthContext.tsx  # Stan auth, login/logout
├── components/
│   ├── AdminPanel.tsx   # Zarządzanie użytkownikami
│   ├── Login.tsx        # Formularz logowania
│   └── ProtectedRoute.tsx # Guard routingu
└── App.tsx              # Routing, AuthProvider
```

---

## 3. Tabela `app_users`

```sql
CREATE TABLE app_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user')),
  display_name TEXT,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login DATETIME
);
```

---

## 4. Endpointy API

### 4.1 Autentykacja

| Endpoint | Metoda | Dostęp | Opis |
|----------|--------|--------|------|
| `POST /auth/login` | POST | public | Logowanie |
| `GET /auth/me` | GET | auth | Dane zalogowanego |
| `POST /auth/change-password` | POST | auth | Zmiana hasła |

#### POST /auth/login
```typescript
// Request
{ username: string, password: string }

// Response 200
{
  token: "eyJhbG...",
  user: {
    id: 1,
    username: "admin",
    role: "admin",
    display_name: "Administrator"
  }
}

// Response 401
{ error: "Nieprawidłowy login lub hasło" }
```

#### GET /auth/me
```typescript
// Headers
Authorization: Bearer <token>

// Response 200
{
  id: 1,
  username: "admin",
  role: "admin",
  display_name: "Administrator",
  last_login: "2025-01-17T10:30:00Z"
}
```

### 4.2 Admin - Zarządzanie użytkownikami

| Endpoint | Metoda | Dostęp | Opis |
|----------|--------|--------|------|
| `GET /admin/users` | GET | admin | Lista użytkowników |
| `POST /admin/users` | POST | admin | Nowy użytkownik |
| `PUT /admin/users/:id` | PUT | admin | Edycja użytkownika |
| `DELETE /admin/users/:id` | DELETE | admin | Dezaktywacja |

#### POST /admin/users
```typescript
// Request
{
  username: string,
  password: string,
  role: "admin" | "user",
  display_name?: string
}

// Response 201
{
  id: 2,
  username: "pma",
  role: "user",
  display_name: "Project Manager"
}
```

---

## 5. Middleware

### requireAuth
Sprawdza czy request ma valid JWT token.

```typescript
// Użycie
router.get('/protected', requireAuth, (req, res) => {
  // req.user zawiera { userId, username, role }
});
```

### requireRole
Sprawdza czy użytkownik ma wymaganą rolę.

```typescript
// Użycie - tylko admin
router.get('/admin-only', requireAuth, requireRole('admin'), handler);

// Użycie - admin LUB user
router.get('/any-role', requireAuth, requireRole('admin', 'user'), handler);
```

---

## 6. JWT Token

### Payload
```typescript
interface JWTPayload {
  userId: number;
  username: string;
  role: 'admin' | 'user';
  iat: number;  // issued at
  exp: number;  // expires (7 dni)
}
```

### Konfiguracja
```bash
# .env
JWT_SECRET=twoj-sekretny-klucz-min-32-znaki
```

---

## 7. WebSocket Auth

Socket.io wymaga tokena przy połączeniu:

```typescript
// Frontend - połączenie
const socket = io(API_URL, {
  auth: { token: localStorage.getItem('token') }
});

// Backend - weryfikacja
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Brak tokena'));

  const payload = verifyToken(token);
  if (!payload) return next(new Error('Nieprawidłowy token'));

  socket.data.user = payload;
  next();
});
```

---

## 8. Frontend - AuthContext

### Provider
```tsx
<AuthProvider>
  <App />
</AuthProvider>
```

### Hook
```tsx
const { user, token, login, logout, isAdmin } = useAuth();

// user - dane użytkownika lub null
// token - JWT token lub null
// login(username, password) - logowanie
// logout() - wylogowanie
// isAdmin - czy rola === 'admin'
```

### ProtectedRoute
```tsx
// Wymaga zalogowania
<ProtectedRoute>
  <Dashboard />
</ProtectedRoute>

// Wymaga roli admin
<ProtectedRoute requiredRole="admin">
  <AdminPanel />
</ProtectedRoute>
```

---

## 9. Zmienne Środowiskowe

### Backend (.env)
```bash
JWT_SECRET=zmien-mnie-na-bezpieczny-secret-min-32-znaki
ADMIN_USERNAME=admin
ADMIN_PASSWORD=twoje-bezpieczne-haslo
```

### Frontend (.env)
```bash
VITE_API_URL=http://localhost:3001
```

---

## 10. Pierwszy Admin

Admin jest tworzony automatycznie przy starcie serwera (seedAdminUser):
- Username: z `ADMIN_USERNAME` lub "admin"
- Password: z `ADMIN_PASSWORD` lub "admin123"
- Role: "admin"

**WAŻNE:** Zmień hasło admina w produkcji!

---

## 11. Hasła

- Hashowane przez bcrypt (12 rounds)
- Minimum 6 znaków dla nowych haseł
- Weryfikacja async: `verifyPassword(password, hash)`

---

## 12. Bezpieczeństwo

1. **Token w localStorage** - wyczyść przy wylogowaniu
2. **HTTPS w produkcji** - token przesyłany w headerze
3. **JWT_SECRET** - min 32 znaki, losowy string
4. **Dezaktywacja** - `is_active = 0` zamiast DELETE
5. **Role check** - frontend + backend weryfikacja

---

## 13. Routing Frontend

| Ścieżka | Komponent | Dostęp |
|---------|-----------|--------|
| `/login` | Login | public |
| `/` | Dashboard | auth |
| `/admin` | AdminPanel | admin |

---

## 14. Typowe Problemy

### "Nieprawidłowy token"
- Token wygasł (7 dni)
- Zły JWT_SECRET
- Token uszkodzony

### "Brak tokena autoryzacji"
- Nie zalogowany
- Token nie wysłany w headerze
- localStorage wyczyszczony

### WebSocket nie łączy
- Token nie przekazany w `auth`
- Backend nie ma middleware io.use()

---

## 15. Rozszerzanie

### Dodanie nowej roli
1. Zmień CHECK constraint w tabeli
2. Dodaj do typu `UserRole`
3. Użyj w `requireRole('nowa-rola')`

### Dodanie nowego chronionego endpointu
```typescript
import { requireAuth, requireRole } from '../auth/middleware.js';

router.get('/new-endpoint', requireAuth, requireRole('admin'), (req, res) => {
  // req.user dostępny
});
```
