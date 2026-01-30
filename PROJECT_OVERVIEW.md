# Live Edits v3 - Project Overview

## What Was Built

A production-ready, lightweight collaborative WYSIWYG editor system designed specifically for Health Infobase's workflow.

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    EC2 Instance (AWS)                       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Static HTML Files                                   │  │
│  │  ├── _live-edits/product-name/                       │  │
│  │  │   ├── index.html (with embedded widget)         │  │
│  │  │   └── .live-edits/config.json                     │  │
│  │  └── widget/editor.js                                │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          ↕ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────┐
│                  Azure VM (Backend Server)                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Node.js Server (Express + Socket.IO)                │  │
│  │  ├── API Endpoints                                   │  │
│  │  ├── WebSocket Server                                │  │
│  │  └── SQLite Database (database.db)                  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Server (`server/`)
- **Express API** - REST endpoints for CRUD operations
- **Socket.IO** - Real-time WebSocket server
- **SQLite Database** - Lightweight, file-based storage
- **Features:**
  - Project registration
  - Edit storage (HTML snapshots)
  - Comment management
  - Presence tracking
  - Real-time collaboration

### 2. Widget (`widget/`)
- **Vanilla JavaScript** - No framework dependencies
- **Embeddable** - Single script file
- **Features:**
  - WYSIWYG editing
  - Comment system
  - Real-time presence
  - Auto-save on "Save Changes"

### 3. Scripts (`scripts/`)
- **setup-product.js** - Initialize new product (supports selective file/subfolder copying)
- **publish-product.js** - Export edits back to original folder
- **utils.js** - Shared utilities

## Workflow

1. **Setup** (Developer)
   ```bash
   # Copy entire folder
   node scripts/setup-product.js /path/to/product-folder
   
   # Copy only specific subfolders from a topic folder
   node scripts/setup-product.js /path/to/topic-folder --subfolders product1,product2
   
   # Copy only specific HTML files
   node scripts/setup-product.js /path/to/folder --files index.html,about/index.html
   ```
   - Copies folder (or selected subfolders/files) to `_live-edits/products/product-name/`
   - Injects editor scripts
   - Registers with server

2. **Edit** (Client)
   - Visits preview URL
   - Enters name, enables editing
   - Makes edits, adds comments
   - Saves changes

3. **Publish** (Developer)
   ```bash
   node scripts/publish-product.js product-name
   ```
   - Fetches edits from server
   - Reconstructs HTML files
   - Copies back to original folder
   - Creates backup

## File Structure

```
live-edits-v3/
├── server/                 # Azure VM code
│   ├── src/
│   │   ├── index.js        # Express server entry
│   │   ├── database.js    # SQLite operations
│   │   ├── routes.js      # API routes
│   │   ├── websocket.js   # WebSocket handlers
│   │   └── init-db.js     # DB initialization
│   ├── package.json
│   └── .env.example
├── widget/                 # Embeddable editor
│   ├── editor.js          # Main widget file
│   └── README.md
├── scripts/                # Utility scripts
│   ├── setup-product.js
│   ├── publish-project.js
│   └── utils.js
├── example.html           # Example HTML file
├── README.md              # Main documentation
├── SETUP.md               # Setup instructions
└── PROJECT_OVERVIEW.md    # This file
```

## Technology Stack

- **Backend:** Node.js, Express, Socket.IO, SQLite (better-sqlite3)
- **Frontend:** Vanilla JavaScript, Socket.IO Client
- **Storage:** SQLite database
- **Real-time:** WebSocket via Socket.IO

## Key Features

✅ **WYSIWYG Editing** - Rich text formatting  
✅ **Real-time Collaboration** - Multiple users editing simultaneously  
✅ **Comment System** - Click-to-place comments  
✅ **Presence Indicators** - See who's active  
✅ **Edit History** - Track all changes  
✅ **Project Management** - Organize by folder  
✅ **Simple Workflow** - Copy → Edit → Publish  
✅ **No Authentication Required** - Uses names/initials  
✅ **Lightweight** - SQLite, no external dependencies  

## Next Steps

1. **Deploy Server** to Azure VM
2. **Copy Widget** to EC2 web server
3. **Test Setup** with a sample project
4. **Customize** widget styling if needed
5. **Monitor** server logs and performance

## Configuration Points

1. **Server URL** - Update in `widget/editor.js` and scripts
2. **CORS Origins** - Configure in `server/.env`
3. **Widget Path** - Update in `scripts/setup-product.js`
4. **Database Path** - Configure in `server/.env`

## Notes

- Server must be running before using scripts
- Widget requires Socket.IO client (injected automatically)
- HTML files need `class="editable"` on elements to edit
- Original folders are overwritten on publish (backup created first)

## Support

See individual README files in each directory for detailed documentation:
- `server/README.md` - API documentation
- `widget/README.md` - Widget usage
- `scripts/README.md` - Script documentation
- `SETUP.md` - Complete setup guide
