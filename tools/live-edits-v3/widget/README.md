# Widget - Embeddable Editor

The widget is a vanilla JavaScript file that can be embedded into any HTML page.

## Installation

1. Copy `editor.js` to your web server
2. Update `SERVER_URL` in `editor.js` to point to your Azure VM server
3. Inject script tag into HTML files (done automatically by setup script)

## Usage

The editor supports two modes for determining which elements are editable:

### Selective Mode (Default)

Add `class="editable"` to any element you want to make editable. Only elements with this class will be editable:

```html
<div class="editable">
  <h1>Editable Heading</h1>
  <p>Editable paragraph text</p>
</div>

<div>
  <p>This content is NOT editable</p>
</div>
```

### Default Mode (Everything Editable)

If no `.editable` elements are found on the page, the editor automatically switches to "default mode" where **everything is editable** except elements marked with `class="non-editable"`:

```html
<div>
  <h1>This is editable</h1>
  <p>This is also editable</p>
</div>

<div class="non-editable">
  <p>This content is NOT editable</p>
</div>
```

**Note:** The editor automatically detects which mode to use based on whether `.editable` elements exist on the page. You cannot use both modes simultaneously - if `.editable` elements are present, selective mode is used.

## Features

- **Dual-mode editing**: Selective (`.editable` only) or default (everything except `.non-editable`)
- **Element-by-element saving**: Only saves edited content, preserving interactive elements and scripts
- WYSIWYG editing with formatting toolbar
- Real-time collaboration (WebSocket)
- Comment system
- Presence indicators
- Auto-save on "Save Changes" button
- Edit history with revert functionality

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
