import { generateId } from './database.js';
import {
  validateWebSocketJoin,
  validateWebSocketHeartbeat,
  validateUUID,
  validatePath,
  sanitizeError
} from './security.js';

/**
 * WebSocket handlers for real-time collaboration
 */
export function setupWebSocket(io, db) {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Join a project/page room
    socket.on('join', (data) => {
      try {
        // Validate input
        const validation = validateWebSocketJoin(data);
        if (!validation.valid) {
          socket.emit('error', { message: validation.errors.join(', ') });
          return;
        }

        const { projectId, pagePath, userId, userName } = validation.sanitized;
        const room = `${projectId}:${pagePath}`;
        socket.join(room);
        
        // Update presence
        const presenceId = generateId();
        const updatePresence = db.prepare(`
          INSERT OR REPLACE INTO presence (id, project_id, page_path, user_id, user_name, last_seen)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        // Use existing presence ID if user already present
        const getExisting = db.prepare(`
          SELECT id FROM presence 
          WHERE project_id = ? AND page_path = ? AND user_id = ?
        `);
        const existing = getExisting.get(projectId, pagePath, userId);
        
        const id = existing?.id || presenceId;
        updatePresence.run(id, projectId, pagePath, userId, userName, Date.now());

      // Broadcast updated presence to room
      const getPresence = db.prepare(`
        SELECT DISTINCT user_id, user_name, MAX(last_seen) as last_seen
        FROM presence 
        WHERE project_id = ? AND page_path = ? AND last_seen > ? - 30000
        GROUP BY user_id, user_name
      `);
      const presence = getPresence.all(projectId, pagePath, Date.now());
      
        io.to(room).emit('presence-update', presence);

        socket.emit('joined', { room, presence });
      } catch (error) {
        console.error('Error in join handler:', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    // Handle edit broadcasts
    socket.on('edit', (data) => {
      try {
        // Basic validation
        if (!data || !data.projectId || !data.pagePath) {
          socket.emit('error', { message: 'Invalid edit data' });
          return;
        }

        // Validate projectId and pagePath
        const projectIdValidation = validateUUID(data.projectId, 'projectId');
        if (!projectIdValidation.valid) {
          socket.emit('error', { message: projectIdValidation.error });
          return;
        }

        const pagePathValidation = validatePath(data.pagePath, 'pagePath');
        if (!pagePathValidation.valid) {
          socket.emit('error', { message: pagePathValidation.error });
          return;
        }

        const { projectId, pagePath } = { projectId: data.projectId, pagePath: pagePathValidation.sanitized };
        const room = `${projectId}:${pagePath}`;
        
        // Broadcast to others in room (excluding sender)
        socket.to(room).emit('edit-received', {
          projectId,
          pagePath,
          htmlContent: data.htmlContent,
          editedBy: data.editedBy,
          timestamp: Date.now()
        });
      } catch (error) {
        console.error('Error in edit handler:', error);
        socket.emit('error', { message: 'Failed to broadcast edit' });
      }
    });

    // Handle comment broadcasts
    socket.on('comment', ({ projectId, pagePath, comment }) => {
      const room = `${projectId}:${pagePath}`;
      
      // Broadcast to others in room
      socket.to(room).emit('comment-received', {
        projectId,
        pagePath,
        comment,
        timestamp: Date.now()
      });
    });

    // Handle cursor/selection tracking
    socket.on('cursor', ({ projectId, pagePath, userId, position }) => {
      const room = `${projectId}:${pagePath}`;
      
      // Broadcast to others (excluding sender)
      socket.to(room).emit('cursor-update', {
        userId,
        position,
        timestamp: Date.now()
      });
    });

    // Update presence heartbeat
    socket.on('heartbeat', (data) => {
      try {
        // Validate input
        const validation = validateWebSocketHeartbeat(data);
        if (!validation.valid) {
          // Don't emit error for heartbeat failures, just ignore
          return;
        }

        const { projectId, pagePath, userId } = validation.sanitized;
        const updatePresence = db.prepare(`
          UPDATE presence 
          SET last_seen = ?
          WHERE project_id = ? AND page_path = ? AND user_id = ?
        `);
        updatePresence.run(Date.now(), projectId, pagePath, userId);
      } catch (error) {
        console.error('Error in heartbeat handler:', error);
        // Don't emit error for heartbeat failures
      }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });
}
