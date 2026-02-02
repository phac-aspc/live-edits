# Live Edits Templates

This folder contains templates for creating new products in Live Edits.

## Available Templates

### Data Blog Template (`data-blog`)

A template for creating data blog pages with:
- Key findings sections
- Statistics and highlights
- Data tables
- Related products section
- Infographic placeholders
- Government of Canada styling

## Using Templates

### Method 1: Via Landing Page (Recommended)

1. Navigate to `/_live-edits/index.html`
2. Click "Use Template" on the template card
3. Enter a product name when prompted
4. Run the copy command shown in the dialog, or manually run:
   ```bash
   node scripts/copy-template.js <template-name> <product-name>
   ```

### Method 2: Command Line

From the `_live-edits` directory:

```bash
node scripts/copy-template.js data-blog my-new-blog
```

This will:
- Copy the template to `_live-edits/products/my-new-blog/`
- Inject the editor widget into HTML files
- Register the product with the server
- Create the `.live-edits/config.json` file

## Creating New Templates

To create a new template:

1. Create a new folder in `templates/` with your template name
2. Add your HTML files (start with `index.html`)
3. Use the `editable` class on elements that should be editable
4. Include the editor widget script:
   ```html
   <script src="/_live-edits/widget/editor.js" data-live-edits-folder-path="/_live-edits/templates/your-template"></script>
   ```
5. Add a template card to `/_live-edits/index.html` in the templates section

## Template Structure

Templates should follow this structure:

```
templates/
└── template-name/
    ├── index.html          # Main page
    ├── other-page.html     # Additional pages (optional)
    └── assets/             # Images, CSS, etc. (optional)
```

## Notes

- Templates are read-only when viewed directly
- Users must save templates as new products to edit them
- The `copy-template.js` script handles all setup automatically
- Templates should include the `editable` class on `<main>` or content sections
