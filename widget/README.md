# Widget - Embeddable Editor

The widget is a vanilla JavaScript file that can be embedded into any HTML page.

## Installation

1. Copy `editor.js` to your web server
2. Update `SERVER_URL` in `editor.js` to point to your Azure VM server
3. Inject script tag into HTML files (done automatically by setup script)

## Usage

Add `class="editable"` to any element you want to make editable:

```html
<div class="editable">
  <h1>Editable Heading</h1>
  <p>Editable paragraph text</p>
</div>
```

## Features

- WYSIWYG editing with formatting toolbar
- Real-time collaboration (WebSocket)
- Comment system
- Presence indicators
- Auto-save on "Save Changes" button

## Configuration

Edit the constants at the top of `editor.js`:

```javascript
const SERVER_URL = 'http://your-azure-vm-domain.com:3000';
```

## Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)

## Notes

- Uses localStorage for user ID and name
- Requires Socket.IO client library (included via CDN or bundled)
- CORS must be configured on server for your domain
