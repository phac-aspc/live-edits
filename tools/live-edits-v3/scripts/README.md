# Scripts

Utility scripts for managing Live Edits products.

## setup-product.js

Sets up a new product for live editing.

**Usage:**
```bash
# Use absolute path (recommended on EC2)
node scripts/setup-product.js /full/path/to/product-folder

# Or relative to current directory
node scripts/setup-product.js ./my-product
```

**Find product folders (EC2):**
```bash
# List folders in current directory
node scripts/setup-product.js --list

# List folders in a specific directory (e.g. where your products live)
node scripts/setup-product.js --list /var/www/products
node scripts/setup-product.js --list /home/ubuntu/sites
```

Then use one of the listed folder names with the full path:
```bash
node scripts/setup-product.js /var/www/products/my-product-name
```

**Selective copying options:**

For topic folders that contain multiple product subfolders, or when you only want specific HTML files:

```bash
# Copy only specific subfolders from a topic folder
node scripts/setup-product.js /path/to/topic-folder --subfolders product1,product2

# Copy only specific HTML files
node scripts/setup-product.js /path/to/folder --files index.html,about/index.html,contact.html

# Combine both options
node scripts/setup-product.js /path/to/topic-folder --subfolders product1 --files product1/index.html,product1/about.html
```

**What it does:**
1. Copies folder (or selected subfolders/files) to `_live-edits/products/product-name/`
2. Injects editor script into all HTML files
3. Creates `.live-edits/config.json`
4. Registers product with Azure VM server

**Note:** By default, "archive" subfolders are excluded from copying unless explicitly specified. To include archive folders, add them to the `--subfolders` list (e.g., `--subfolders product1,archive`) or explicitly list files within archive folders using `--files`.

**Environment Variables:**
- `SERVER_URL` - Azure VM server URL (default: http://en.infobase-dev.com/live-edits)

**EC2 path tips:**
- Run from the directory that contains `_live-edits` (or where you want it created), e.g. your web root.
- Use **absolute paths** for product folders so the path is correct no matter where you run the script: `/var/www/my-product`
- Use `--list /path/to/parent` to see available folders before running setup.

## publish-product.js

Publishes edits back to original folder.

**Usage:**
```bash
node scripts/publish-product.js product-name
```

**What it does:**
1. Fetches latest edits from server
2. Applies element-by-element edits (new format) or reconstructs full HTML (legacy format)
3. Removes editor scripts and `data-live-edits-id` attributes
4. Copies files back to original folder
5. Creates backup in `_backups/`

**Note:** The script automatically detects whether edits are in the new JSON format (element-by-element) or legacy HTML format and handles both appropriately.

**Environment Variables:**
- `SERVER_URL` - Azure VM server URL

## Notes

- Scripts must be run from the product root directory
- Ensure server is running before using scripts
- Original folder will be overwritten (backup created first)
- When using selective copying, the original source path is stored in config.json for publishing
- **Archive folders are excluded by default** - they will not be copied unless explicitly specified in `--subfolders` or files within them are listed in `--files`
