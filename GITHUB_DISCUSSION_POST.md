# 🎨 Introducing Live Edits v3 - Collaborative WYSIWYG Editor Tool

Hello team! 👋

I'm excited to introduce **Live Edits v3**, a new collaborative WYSIWYG editor tool that streamlines our content editing workflow. This tool allows clients and team members to make real-time edits to HTML content with a user-friendly interface, and then publish those changes back to the original project folders.

## What is Live Edits?

Live Edits is a lightweight, production-ready collaborative editor system designed specifically for our Health Infobase workflow. It enables:

- ✏️ **WYSIWYG Editing** - Rich text formatting directly in the browser
- 👥 **Real-time Collaboration** - Multiple users can edit simultaneously
- 💬 **Comment System** - Click-to-place comments for feedback
- 👀 **Presence Indicators** - See who's currently active on a page
- 📝 **Edit History** - Track all changes over time
- 🔄 **Simple Workflow** - Copy → Edit → Publish

## Architecture

The system consists of:
- **EC2 Instance**: Serves static HTML files with the embedded editor widget
- **Azure VM**: Node.js backend server with SQLite database (handles all edits and collaboration)
- **Widget**: Vanilla JavaScript embeddable editor (no framework dependencies)

## 📚 Documentation

**Full documentation is available in C9** - please refer to the C9 documentation for detailed setup instructions, API reference, and advanced usage.

## 💻 Code Repository

The codebase is available in our GitHub repository:
**https://github.com/btrembl/health-infobase-projects**

The tool is located in: `tools/live-edits-v3/`

## 🚀 Quick Start Guide

### 1. Getting Started in C9

1. Navigate to your C9 environment
2. Ensure you're in the directory that contains (or will contain) the `_live-edits` folder
3. The server should already be running on the Azure VM - if not, check with the team

### 2. Adding Your Project to Live Edits

To set up a product folder for live editing, use the `setup-product.js` script:

```bash
# List available products in a directory
node scripts/setup-product.js --list /path/to/products

# Setup a product (use full absolute path)
node scripts/setup-product.js /path/to/your-product-folder

# For topic folders with multiple products, copy only specific subfolders
node scripts/setup-product.js /path/to/topic-folder --subfolders product1,product2

# Copy only specific HTML files
node scripts/setup-product.js /path/to/folder --files index.html,about/index.html
```

**What happens:**
- Your product folder (or selected subfolders/files) is copied to `_live-edits/products/product-name/`
- The editor widget is automatically injected into all HTML files
- The product is registered with the Azure VM server
- A preview URL is generated for client access

**Note:** Archive folders are excluded by default unless explicitly specified.

### 3. Publishing Edits Back to Original Folder

Once edits have been made by clients or team members, publish them back to your original folder:

```bash
node scripts/publish-product.js product-name
```

**What happens:**
- Fetches the latest edits from the Azure VM server
- Reconstructs HTML files with the edited content
- Creates a backup in `_backups/product-name/timestamp/`
- Copies updated files back to your original folder

**Important:** The original folder will be overwritten, but a backup is created first for safety.

## 📋 Example Workflow

```bash
# 1. Setup your product
node scripts/setup-product.js /home/ec2-user/environment/my-product

# 2. Share the preview URL with clients/team
# (URL format: https://your-ec2-domain/_live-edits/products/my-product/index.html)

# 3. After edits are complete, publish back
node scripts/publish-product.js my-product
```

## 🎯 Key Features

- **No Authentication Required** - Uses names/initials for identification
- **Lightweight** - SQLite database, minimal dependencies
- **Selective Copying** - Copy entire folders, specific subfolders, or individual files
- **Automatic Backup** - Backups created before publishing
- **Real-time Sync** - Changes appear instantly for all collaborators

## 📖 Additional Resources

- **C9 Documentation** - Full documentation and detailed guides
- **GitHub Repository** - https://github.com/btrembl/health-infobase-projects
- **Project Overview** - See `tools/live-edits-v3/PROJECT_OVERVIEW.md` in the repo
- **Scripts Documentation** - See `tools/live-edits-v3/scripts/README.md` in the repo

## ❓ Questions?

If you have any questions or run into issues, please reach out to the team or check the C9 documentation for troubleshooting tips.

Happy editing! 🎉
