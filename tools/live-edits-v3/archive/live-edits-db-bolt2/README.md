# WYSIWYG Page Editor with Comments

A powerful, embeddable WYSIWYG editor that can be added to any HTML page, allowing users to edit content and add comments. All changes are tracked with user initials and timestamps, stored in Supabase.

## Features

- **Rich Text Editing**: Format text with bold, italic, underline, lists, headings, and more
- **Comment System**: Add comments anywhere on the page with visual markers
- **Edit History**: Complete audit trail of all edits with attribution
- **Dashboard View**: Visual timeline showing all edits and comments
- **No Authentication Required**: Uses initials for simple attribution
- **Cloud Storage**: All data stored securely in Supabase
- **Easy Integration**: Just add one script tag to any HTML page

## Quick Start

### 1. Installation

```bash
npm install
```

### 2. Configuration

The `.env` file is already configured with Supabase credentials:

```env
VITE_SUPABASE_URL=your-supabase-url
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Run Development Server

```bash
npm run dev
```

This will start a Vite dev server at `http://localhost:3000`

### 4. Build for Production

```bash
npm run build
```

## How to Use

### Adding to Your HTML Page

1. Make sure any content you want to be editable has the `editable` class:

```html
<div class="editable">
  <h1>This content can be edited</h1>
  <p>Users can format and modify this text</p>
</div>
```

2. Add the configuration script and editor library before the closing `</body>` tag:

```html
<script>
  // Load environment variables
  fetch('/.env')
    .then(response => response.text())
    .then(text => {
      const lines = text.split('\n');
      lines.forEach(line => {
        if (line.includes('VITE_SUPABASE_URL=')) {
          window.SUPABASE_URL = line.split('=')[1].trim();
        }
        if (line.includes('VITE_SUPABASE_ANON_KEY=')) {
          window.SUPABASE_ANON_KEY = line.split('=')[1].trim();
        }
      });
    });
</script>
<script src="page-editor.js"></script>
```

### Using the Editor

1. **Enter Your Initials**: Type your initials in the toolbar at the top
2. **Enable Editing**: Click the "Enable Editing" button
3. **Edit Content**: Click on any element with the `editable` class to start editing
4. **Format Text**: Use the formatting toolbar that appears above the selected element
5. **Add Comments**: Click "Add Comment" then click anywhere on the page
6. **Save Changes**: Click "Save Changes" to persist your edits
7. **View History**: Click "Dashboard" to see edit history and all comments

## Architecture

### Components

1. **Client Library** (`public/page-editor.js`)
   - Handles UI interactions
   - WYSIWYG editing controls
   - Comment markers and popups
   - Communicates with API

2. **API Backend** (`supabase/functions/page-editor-api/index.ts`)
   - Edge Function handling all data operations
   - Routes for edits, comments, and statistics
   - CORS-enabled for browser access

3. **Database** (Supabase PostgreSQL)
   - `page_edits` table: Stores complete page snapshots
   - `comments` table: Stores comments with positions
   - Row Level Security enabled for public access

4. **Dashboard** (`public/dashboard.html`)
   - Visual timeline of all activity
   - Statistics display
   - Searchable by page URL

### API Endpoints

All endpoints are under `/functions/v1/page-editor-api`:

- `GET /edits?pageUrl=...` - Get latest edit for a page
- `GET /edits?pageUrl=...&all=true` - Get all edits for a page
- `POST /edits` - Save a new edit
- `GET /comments?pageUrl=...` - Get all comments for a page
- `POST /comments` - Create a new comment
- `DELETE /comments/:id` - Delete a comment
- `GET /stats?pageUrl=...` - Get statistics for a page

### Database Schema

**page_edits**
```sql
- id (uuid, primary key)
- page_url (text) - URL or path of the page
- html_content (text) - Complete HTML content
- edited_by (text) - User initials
- created_at (timestamptz)
```

**comments**
```sql
- id (uuid, primary key)
- page_url (text) - URL or path of the page
- comment_text (text) - The comment content
- x_position (integer) - X coordinate
- y_position (integer) - Y coordinate
- initials (text) - User initials
- created_at (timestamptz)
```

## Customization

### Styling

The editor includes inline styles, but you can customize:

- Toolbar colors and layout
- Comment marker appearance
- Editable element highlighting
- WYSIWYG control buttons

### Functionality

You can extend the system by:

- Adding more formatting options to the WYSIWYG controls
- Implementing user authentication instead of initials
- Adding version comparison/diff views
- Implementing undo/redo functionality
- Adding real-time collaboration with WebSockets

## Security Considerations

- Currently uses public access with initials for attribution
- For production use, consider adding authentication
- All data is stored with Row Level Security enabled
- CORS is configured for cross-origin access
- Input validation is performed on the backend

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Any modern browser with ES6+ support

## License

This project is open source and available under the MIT License.

## Support

For issues or questions, please open an issue on the repository.
