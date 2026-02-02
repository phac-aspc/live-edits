# Live Edits Landing Page

## Overview

The landing page (`index.html`) provides a dashboard for managing Live Edits products and templates.

## Features

### Current Editable Products Section

- Displays all products currently set up for live editing
- Shows each product in a card format with:
  - Product name
  - Folder path
  - Latest edit timestamp (relative time, e.g., "2 hours ago")
  - Badge indicating if the product has edits
- Products are sorted by most recently edited first
- Clicking a product card opens the product in a new tab

### Product Templates Section

- Displays available templates for creating new products
- Currently includes:
  - **Data Blog Template**: Template for creating data blog pages with key findings, statistics, and visualizations
- Clicking "Use Template" opens the template in read-only mode and shows a dialog to save it as a new product

## Usage

### Viewing Products

1. Navigate to `/_live-edits/index.html`
2. The page automatically loads and displays all registered products
3. Click on any product card to open it for editing

### Creating a Product from Template

1. Navigate to `/_live-edits/index.html`
2. Click "Use Template" on the desired template
3. Enter a product name (alphanumeric, dashes, and underscores only)
4. Run the command shown in the dialog:
   ```bash
   node scripts/copy-template.js <template-name> <product-name>
   ```
5. The product will be created and you'll be redirected to it

### Manual Template Copy

If the automated process doesn't work, you can manually copy templates:

```bash
# From the _live-edits directory
node scripts/copy-template.js data-blog my-product-name
```

## API Integration

The landing page fetches product data from the Live Edits server API:

- `GET /live-edits/projects` - List all products
- `GET /live-edits/edits/project/:projectId` - Get edits for a product (used to find latest edit timestamp)

## File Structure

```
_live-edits/
├── index.html              # Landing page
├── templates/              # Template folder
│   ├── data-blog/          # Data blog template
│   │   └── index.html
│   └── README.md
└── products/               # Created products (not in repo)
    └── [product-name]/
        └── ...
```

## Customization

### Adding New Templates

1. Create a new folder in `templates/` with your template files
2. Add a template card to `index.html` in the templates section:
   ```html
   <div class="template-card" data-template="your-template-name">
     <div class="template-icon">📄</div>
     <h3>Your Template Name</h3>
     <p>Description of your template.</p>
     <span class="template-badge">Template</span>
     <button class="btn-template" onclick="openTemplate('your-template-name')">Use Template</button>
   </div>
   ```

### Styling

The landing page uses inline CSS for easy customization. Key classes:
- `.product-card` - Product card styling
- `.template-card` - Template card styling
- `.section` - Section container styling

## Troubleshooting

### Products Not Loading

- Check that the server is running and accessible
- Verify the `SERVER_URL` in the JavaScript matches your server URL
- Check browser console for API errors

### Template Copy Fails

- Ensure you're running the command from the `_live-edits` directory
- Check that the template folder exists in `templates/`
- Verify the product name doesn't already exist
- Check file permissions on the server

### Latest Edit Timestamps Not Showing

- Edits are fetched from the server API
- If a product has no edits, it will show "No edits yet"
- Timestamps are calculated client-side from server timestamps
