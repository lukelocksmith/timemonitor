import { Server, Socket } from 'socket.io';

type SocketUser = {
  role?: string;
  clickup_user_id?: string | null;
};

type SessionEntry = Record<string, unknown> & { user_id?: string };

function canViewAll(user: SocketUser): boolean {
  return user.role === 'admin' || user.role === 'pm';
}

export function sendActiveSessionsToSocket(socket: Socket, sessions: SessionEntry[]) {
  const user = (socket.data.user || {}) as SocketUser;

  if (canViewAll(user)) {
    socket.emit('active_sessions', sessions);
    return;
  }

  const clickupUserId = user.clickup_user_id;
  if (!clickupUserId) {
    socket.emit('active_sessions', []);
    return;
  }

  const filtered = sessions.filter((entry) => entry.user_id === clickupUserId);
  socket.emit('active_sessions', filtered);
}

export function emitActiveSessions(io: Server, sessions: SessionEntry[]) {
  for (const socket of io.sockets.sockets.values()) {
    sendActiveSessionsToSocket(socket, sessions);
  }
}

export function emitScopedEvent(io: Server, event: string, payload: SessionEntry) {
  for (const socket of io.sockets.sockets.values()) {
    const user = (socket.data.user || {}) as SocketUser;
    if (canViewAll(user)) {
      socket.emit(event, payload);
      continue;
    }

    if (user.clickup_user_id && payload.user_id === user.clickup_user_id) {
      socket.emit(event, payload);
    }
  }
}
