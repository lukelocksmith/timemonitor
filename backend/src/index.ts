import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDatabase, db, getAppUserById } from './database.js';
import { webhookRouter } from './routes/webhook.js';
import { apiRouter } from './routes/api.js';
import { authRouter } from './routes/auth.js';
import { adminRouter } from './routes/admin.js';
import { notionRouter } from './routes/notion.js';
import { earningsRouter } from './routes/earnings.js';
import { startPolling } from './polling.js';
import { verifyToken } from './auth/jwt.js';
import { sendActiveSessionsToSocket } from './socket.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

// WebSocket authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Brak tokena autoryzacji'));
  }

  const payload = verifyToken(token);

  if (!payload) {
    return next(new Error('Nieprawidłowy lub wygasły token'));
  }

  const appUser = getAppUserById(payload.userId);
  if (!appUser || !appUser.is_active) {
    return next(new Error('Użytkownik nie istnieje lub jest nieaktywny'));
  }

  if (appUser.role !== 'admin' && !appUser.clickup_user_id) {
    return next(new Error('Brak powiązania z pracownikiem (ClickUp)'));
  }

  // Dodaj dane użytkownika do socket
  socket.data.user = {
    ...payload,
    clickup_user_id: appUser.clickup_user_id,
  };
  next();
});

// Middleware
app.use(cors());
app.use(express.json());

// Przekaż io do routerów przez app.locals
app.locals.io = io;

// Routes - publiczne
app.use('/webhook', webhookRouter);
app.use('/auth', authRouter);

// Routes - wymagające autoryzacji
app.use('/api', apiRouter);
app.use('/admin', adminRouter);
app.use('/api/notion', notionRouter);
app.use('/api/earnings', earningsRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Socket.io - połączenia klientów (tylko autoryzowani)
io.on('connection', (socket) => {
  const user = socket.data.user;
  console.log(`🔌 Klient połączony: ${socket.id} (${user?.username || 'unknown'})`);

  // Wyślij aktualnie aktywne sesje po połączeniu
  const activeSessions = db
    .prepare(
      `SELECT
        te.*,
        u.color as user_color,
        u.profile_picture as user_avatar
       FROM time_entries te
       LEFT JOIN users u ON te.user_id = u.id
       WHERE te.end_time IS NULL
       ORDER BY te.start_time DESC`
    )
    .all() as Array<Record<string, unknown> & { user_id?: string; task_id?: string; task_url?: string }>;

  // Ensure task_url is always set (fallback to generated URL)
  const sessionsWithUrls = activeSessions.map((session) => ({
    ...session,
    task_url: session.task_url || (session.task_id ? `https://app.clickup.com/t/${session.task_id}` : null),
  }));

  sendActiveSessionsToSocket(socket, sessionsWithUrls);

  socket.on('disconnect', () => {
    console.log(`🔌 Klient rozłączony: ${socket.id} (${user?.username || 'unknown'})`);
  });
});

// Start serwera
const PORT = process.env.PORT || 3001;

async function startServer() {
  await initDatabase();

  httpServer.listen(PORT, () => {
    console.log(`
🚀 ClickUp Activity Monitor Backend
   ├─ HTTP:   http://localhost:${PORT}
   ├─ Health: http://localhost:${PORT}/health
   ├─ Auth:   http://localhost:${PORT}/auth/login
   └─ WebSocket: ws://localhost:${PORT} (wymaga tokena)
    `);

    // Uruchom polling aktywnych timerów
    startPolling(io);
  });
}

startServer();

export { io };
