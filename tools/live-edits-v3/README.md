# Live Edits - Production-Ready Collaborative Editor

A lightweight, embeddable WYSIWYG editor for collaborative content editing. Designed for Health Infobase's workflow where developers copy product folders to `_live-edits/products/` for client review and editing.

## Architecture

- **EC2 Instance**: Serves static HTML files with embedded widget
- **Azure VM**: Node.js server with SQLite database (centralized)
- **Widget**: Vanilla JavaScript embeddable editor
- **Real-time**: WebSocket-based collaboration

## Quick Start

### 1. Setup Azure VM Server

```bash
cd server
npm install
# Configure .env with SERVER_URL
npm start
```

### 2. Setup Product on EC2

From the `_live-edits` directory:

```bash
# List available products
node scripts/setup-product.js --list

# Setup a product (use just the product name)
node scripts/setup-product.js amrnet

# Or use full path
node scripts/setup-product.js /home/ec2-user/environment/amrnet

# For topic folders with multiple products, copy only specific subfolders
node scripts/setup-product.js /path/to/topic-folder --subfolders product1,product2

# Copy only specific HTML files
node scripts/setup-product.js /path/to/folder --files index.html,about/index.html
```

This will:
- Copy folder (or selected subfolders/files) to `_live-edits/products/product-name/`
- Inject widget script into HTML files
- Register product with Azure VM server

### 3. Publish Edits

```bash
node scripts/publish-product.js product-name
```

This will:
- Fetch latest edits from Azure VM
- Reconstruct HTML files
- Copy back to original folder

## Project Structure

```
live-edits-v3/
├── server/          # Azure VM code (Express + WebSocket + SQLite)
├── widget/          # Embeddable editor script
├── scripts/         # EC2 utility scripts
└── README.md
```

On EC2, products are stored in:
```
environment/
├── _live-edits/
│   ├── products/    # Product folders for editing
│   │   ├── amrnet/
│   │   └── other-product/
│   ├── scripts/     # Setup/publish scripts
│   └── widget/      # Editor widget files
└── amrnet/          # Original product folder
```

## Configuration

### Server (.env)
```
PORT=3000
SERVER_URL=http://your-azure-vm-domain.com:3000
NODE_ENV=production
```

### Widget (hardcoded in editor.js)
```javascript
const SERVER_URL = 'http://your-azure-vm-domain.com/live-edits';
```

## Scripts Reference

### setup-product.js
Sets up a product folder for live editing.

**Usage:**
```bash
# List available products
node scripts/setup-product.js --list

# Setup product (from _live-edits directory)
node scripts/setup-product.js <product-name>

# Setup with full path
node scripts/setup-product.js /path/to/product-folder

# Copy only specific subfolders from a topic folder
node scripts/setup-product.js /path/to/topic-folder --subfolders product1,product2

# Copy only specific HTML files
node scripts/setup-product.js /path/to/folder --files index.html,about/index.html

# Combine both options
node scripts/setup-product.js /path/to/topic-folder --subfolders product1 --files product1/index.html
```

**What it does:**
- Copies product (or selected subfolders/files) to `_live-edits/products/<product-name>/`
- Injects editor widget into all HTML files
- Creates `.live-edits/config.json` with product metadata
- Registers product with Azure VM server

### publish-product.js
Publishes edited content back to the original product folder.

**Usage:**
```bash
node scripts/publish-product.js <product-name>
```

**What it does:**
- Fetches latest edits from Azure VM server
- Reconstructs HTML files with edited content
- Creates backup in `_backups/<product-name>/<timestamp>/`
- Copies updated files back to original folder

## Features

- ✅ **Dual-mode editing**: Selective (`.editable` only) or default (everything except `.non-editable`)
- ✅ **Element-by-element saving**: Preserves interactive elements, scripts, and event listeners
- ✅ WYSIWYG editing
- ✅ Real-time collaboration
- ✅ Comment system
- ✅ Edit history with revert
- ✅ Presence indicators
- ✅ Backward compatible with existing edits

## License

MIT
