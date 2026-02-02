# Live Edits Server

Backend server running on Azure VM. Handles all API requests and WebSocket connections.

## Quick Start

```bash
npm install
cp .env.example .env
# Edit .env with your configuration
npm start
```

## API Endpoints

### Health Check
```
GET /health
```

### Projects
```
POST /projects
GET /projects/:folderPath
```

### Edits
```
POST /edits
GET /edits/:projectId/:pagePath
GET /edits/project/:projectId
GET /edits/history/:projectId/:pagePath
GET /edits/by-id/:editId
```

### Comments
```
POST /comments
GET /comments/:projectId/:pagePath
DELETE /comments/:commentId
```

### Presence
```
GET /presence/:projectId/:pagePath
```

## WebSocket Events

### Client → Server
- `join` - Join a project/page room
- `edit` - Broadcast edit to others
- `comment` - Broadcast comment
- `cursor` - Broadcast cursor position
- `heartbeat` - Update presence

### Server → Client
- `joined` - Confirmation of join
- `presence-update` - Updated presence list
- `edit-received` - Edit from another user
- `comment-received` - Comment from another user
- `cursor-update` - Cursor from another user

## Database

SQLite database stored at `./database.db` (configurable via DB_PATH).

Schema:
- `projects` - Project metadata
- `edits` - HTML content snapshots
- `comments` - Page comments
- `presence` - Active users

## Production Deployment

### PM2
```bash
pm2 start src/index.js --name live-edits-server
pm2 save
```

### Task Scheduler (Windows)
Create scheduled task to run `node src/index.js`

## Environment Variables

See `.env.example` for all available options.
