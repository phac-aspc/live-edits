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
DELETE /projects/:projectId          # Delete project by ID (cascades to edits/comments/presence)
DELETE /projects/path/:folderPath     # Delete project by folder path
```

### Edits
```
POST /edits
GET /edits/:projectId/:pagePath
GET /edits/project/:projectId
GET /edits/history/:projectId/:pagePath
GET /edits/by-id/:editId
DELETE /edits/:editId                 # Delete specific edit by ID
DELETE /edits/:projectId/:pagePath     # Delete all edits for a page
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

## Deleting Entries

### Option 1: Using the Admin Script (Easiest)

Run the `delete-entry.js` script directly on the Azure server:

```bash
# Delete a project by ID
node scripts/delete-entry.js project <projectId>

# Delete a project by folder path
node scripts/delete-entry.js project-by-path /_live-edits/products/myproduct

# Delete a specific edit
node scripts/delete-entry.js edit <editId>

# Delete all edits for a page
node scripts/delete-entry.js edits-for-page <projectId> <pagePath>

# Delete a comment
node scripts/delete-entry.js comment <commentId>
```

The script will show you what will be deleted and ask for confirmation.

### Option 2: Using API Endpoints

You can also use HTTP DELETE requests:

```bash
# Delete project by ID (cascades to all related data)
curl -X DELETE http://your-server:3000/projects/<projectId>

# Delete project by folder path
curl -X DELETE http://your-server:3000/projects/path/_live-edits/products/myproduct

# Delete specific edit
curl -X DELETE http://your-server:3000/edits/<editId>

# Delete all edits for a page
curl -X DELETE http://your-server:3000/edits/<projectId>/<pagePath>

# Delete comment
curl -X DELETE http://your-server:3000/comments/<commentId>
```

**Note:** Deleting a project will automatically delete all related edits, comments, and presence records due to CASCADE foreign key constraints.

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
