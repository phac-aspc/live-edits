import { Server } from 'socket.io';
import { authorizeToken, validateId, validateName, validatePath } from './security.js';

function roomName(projectId, pagePath) {
  return `page:${projectId}:${pagePath}`;
}

function currentPresence(io, room) {
  const socketIds = io.sockets.adapter.rooms.get(room) || new Set();
  return [...socketIds]
    .map((id) => io.sockets.sockets.get(id)?.data.user)
    .filter(Boolean);
}

function emitPresence(io, room) {
  io.to(room).emit('presence', currentPresence(io, room));
}

export function setupWebsocket(httpServer, db, config) {
  const io = new Server(httpServer, {
    path: config.wsPath,
    cors: { origin: config.corsOrigins, methods: ['GET', 'POST'], credentials: false },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 100_000,
    pingInterval: 25_000,
    pingTimeout: 20_000
  });

  io.use((socket, next) => {
    if (!authorizeToken(config, socket.handshake.auth?.token, 'editor')) {
      return next(new Error('Authentication required.'));
    }
    return next();
  });

  io.on('connection', (socket) => {
    socket.on('join-page', (input, acknowledge = () => {}) => {
      try {
        const projectId = validateId(input?.project_id, 'project id');
        const pagePath = validatePath(input?.page_path, 'page_path');
        const name = validateName(input?.name, 'name', 100);
        const project = db.prepare('SELECT project_path FROM projects WHERE id = ? AND status = ?')
          .get(projectId, 'active');
        if (!project || (project.project_path !== '/'
          && pagePath !== project.project_path
          && !pagePath.startsWith(`${project.project_path}/`))) {
          throw new Error('Project or page not found.');
        }

        if (socket.data.room) socket.leave(socket.data.room);
        const room = roomName(projectId, pagePath);
        socket.data.room = room;
        socket.data.user = { id: socket.id, name };
        socket.join(room);
        emitPresence(io, room);
        acknowledge({ ok: true });
      } catch (error) {
        acknowledge({ ok: false, error: error.message });
      }
    });

    socket.on('disconnect', () => {
      if (socket.data.room) emitPresence(io, socket.data.room);
    });
  });

  return io;
}
