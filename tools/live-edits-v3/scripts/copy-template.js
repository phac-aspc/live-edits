#!/usr/bin/env node

/**
 * Copy Template Script
 * 
 * Usage: node scripts/copy-template.js <template-name> <product-name>
 * 
 * This script copies a template from _live-edits/templates/ to _live-edits/products/
 * and sets it up as a new product.
 */

const {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  readdirSync,
  statSync
} = require('fs');
const { join, dirname, resolve, relative, basename } = require('path');
const { execSync } = require('child_process');

// Configuration
const LIVE_EDITS_FOLDER = '_live-edits';
const TEMPLATES_SUBFOLDER = 'templates';
const PRODUCTS_SUBFOLDER = 'products';
const SERVER_URL = process.env.SERVER_URL || 'http://en.infobase-dev.com/live-edits';
const WIDGET_SCRIPT_PATH = '/_live-edits/widget/editor.js';

// Get command line arguments
const templateName = process.argv[2];
const productName = process.argv[3];

if (!templateName || !productName) {
  console.error('Error: Please provide template name and product name');
  console.log('Usage: node scripts/copy-template.js <template-name> <product-name>');
  console.log('Example: node scripts/copy-template.js data-blog my-new-blog');
  process.exit(1);
}

// Validate product name (alphanumeric, dashes, underscores only)
if (!/^[a-zA-Z0-9_-]+$/.test(productName)) {
  console.error('Error: Product name can only contain letters, numbers, dashes, and underscores');
  process.exit(1);
}

var cwdResolved = resolve(process.cwd());
var liveEditsRoot = basename(cwdResolved) === LIVE_EDITS_FOLDER ? cwdResolved : join(cwdResolved, LIVE_EDITS_FOLDER);
const templatePath = join(liveEditsRoot, TEMPLATES_SUBFOLDER, templateName);
const productPath = join(liveEditsRoot, PRODUCTS_SUBFOLDER, productName);

// Check if template exists
if (!existsSync(templatePath)) {
  console.error('Error: Template not found: ' + templatePath);
  process.exit(1);
}

// Check if product already exists
if (existsSync(productPath)) {
  console.error('Error: Product already exists: ' + productPath);
  console.log('   Please choose a different product name or remove the existing product.');
  process.exit(1);
}

console.log('Copying template to product...');
console.log('   Template: ' + templateName);
console.log('   Product: ' + productName);
console.log('   Source: ' + templatePath);
console.log('   Target: ' + productPath);

// Step 1: Create products directory if it doesn't exist
const productsDir = join(liveEditsRoot, PRODUCTS_SUBFOLDER);
if (!existsSync(productsDir)) {
  console.log('Creating products directory...');
  mkdirSync(productsDir, { recursive: true });
}

// Step 2: Copy template folder recursively
console.log('Copying files...');
copyFolderRecursive(templatePath, productPath);

// Step 3: Update HTML files to inject editor script and update paths
console.log('Updating HTML files...');
const htmlFiles = findHTMLFiles(productPath);
let updatedCount = 0;

const folderPathForMeta = '/' + LIVE_EDITS_FOLDER + '/' + PRODUCTS_SUBFOLDER + '/' + productName;

htmlFiles.forEach(function (filePath) {
  try {
    let htmlContent = readFileSync(filePath, 'utf-8');
    
    // Update the data-live-edits-folder-path in script tag
    htmlContent = htmlContent.replace(
      /data-live-edits-folder-path=["'][^"']*["']/g,
      `data-live-edits-folder-path="${folderPathForMeta}"`
    );
    
    // Update meta tag if it exists
    htmlContent = htmlContent.replace(
      /<meta[^>]*name=["']live-edits-folder-path["'][^>]*>/gi,
      `<meta name="live-edits-folder-path" content="${folderPathForMeta}">`
    );
    
    // Ensure editor script is injected
    if (!htmlContent.includes('editor.js')) {
      const socketIOScript = '<script src="https://cdn.socket.io/4.8.1/socket.io.min.js"></script>';
      const editorScript = `<script src="${WIDGET_SCRIPT_PATH}" data-live-edits-folder-path="${folderPathForMeta}"></script>`;
      
      if (htmlContent.includes('</body>')) {
        htmlContent = htmlContent.replace('</body>', '  ' + socketIOScript + '\n  ' + editorScript + '\n</body>');
      } else {
        htmlContent = htmlContent + '\n' + socketIOScript + '\n' + editorScript + '\n';
      }
    }
    
    // Ensure main has editable class
    htmlContent = addEditableToMain(htmlContent);
    
    writeFileSync(filePath, htmlContent, 'utf-8');
    updatedCount++;
    console.log('   Updated ' + relative(productPath, filePath));
  } catch (error) {
    console.error('   Error processing ' + filePath + ':', error.message);
  }
});

console.log('   Updated ' + updatedCount + ' HTML file(s)');

// Step 4: Create .live-edits directory and config
const liveEditsConfigDir = join(productPath, '.live-edits');
if (!existsSync(liveEditsConfigDir)) {
  mkdirSync(liveEditsConfigDir, { recursive: true });
}

const folderPath = '/' + LIVE_EDITS_FOLDER + '/' + PRODUCTS_SUBFOLDER + '/' + productName;
const config = {
  product_name: productName,
  folder_path: folderPath,
  created_at: new Date().toISOString(),
  server_url: SERVER_URL,
  source_path: null, // Template-based products don't have a source path
  template_source: templateName,
  selective_copy: null
};

const configPath = join(liveEditsConfigDir, 'config.json');
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
console.log('   Created config: ' + relative(productPath, configPath));

// Step 5: Register product with server
console.log('Registering product with server...');
registerProduct(SERVER_URL, folderPath, productName, config, configPath, function() {
  // After registration, automatically run publish-product.js
  console.log('\nTemplate copied successfully!');
  console.log('\nRunning publish-product.js to publish the product...');
  
  try {
    // Get the project root (parent of _live-edits or current directory if already in _live-edits)
    // Use the same logic as at the top of the script
    var currentCwd = resolve(process.cwd());
    const projectRoot = basename(currentCwd) === LIVE_EDITS_FOLDER ? dirname(currentCwd) : currentCwd;
    const publishScriptPath = join(projectRoot, 'scripts', 'publish-product.js');
    
    // Check if script exists
    if (!existsSync(publishScriptPath)) {
      console.warn('\nWarning: publish-product.js not found at: ' + publishScriptPath);
      console.log('   Expected location: ' + publishScriptPath);
      console.log('   Current working directory: ' + process.cwd());
      console.log('\nYou can manually publish by running:');
      console.log('   node scripts/publish-product.js ' + productName);
      return;
    }
    
    const publishCommand = 'node "' + publishScriptPath + '" "' + productName + '"';
    
    console.log('Executing: ' + publishCommand);
    console.log('Working directory: ' + projectRoot);
    
    const publishOutput = execSync(publishCommand, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'inherit'
    });
    
    console.log('\nProduct published successfully!');
    console.log('\nNext steps:');
    console.log('   1. View your product at: /_live-edits/products/' + productName + '/index.html');
  } catch (publishError) {
    console.warn('\nWarning: Failed to automatically publish product:');
    console.warn('   ' + publishError.message);
    if (publishError.stdout) {
      console.log('   Output: ' + publishError.stdout);
    }
    if (publishError.stderr) {
      console.warn('   Error: ' + publishError.stderr);
    }
    console.log('\nYou can manually publish by running:');
    console.log('   node scripts/publish-product.js ' + productName);
    console.log('\nNext steps:');
    console.log('   1. View your product at: /_live-edits/products/' + productName + '/index.html');
    console.log('   2. When ready, run: node scripts/publish-product.js ' + productName);
  }
});

// Helper functions
function copyFolderRecursive(src, dest) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src, { withFileTypes: true });

  for (var i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.name === '.live-edits') continue; // Skip .live-edits folder in template
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyFolderRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

function findHTMLFiles(dir, fileList) {
  if (!fileList) fileList = [];
  const files = readdirSync(dir);

  for (var i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = join(dir, file);
    if (filePath.indexOf('.live-edits') !== -1) continue;
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      findHTMLFiles(filePath, fileList);
    } else if (file.endsWith('.html') || file.endsWith('.htm')) {
      fileList.push(filePath);
    }
  }

  return fileList;
}

function addEditableToMain(htmlContent) {
  if (!htmlContent.match(/<main[\s>]/i)) return htmlContent;
  var out = htmlContent.replace(/<main\s+class="([^"]*)"/gi, function (match, cls) {
    if (cls.indexOf('editable') !== -1) return match;
    return '<main class="' + cls.trim() + ' editable"';
  });
  out = out.replace(/<main>/gi, '<main class="editable">');
  out = out.replace(/<main\s+(?![^>]*\bclass=)[^>]*>/gi, function (match) {
    return '<main class="editable" ' + match.slice(5).trim();
  });
  return out;
}

// HTTP/HTTPS request helper
function registerProduct(serverUrl, folderPath, productName, config, configPath, callback) {
  const url = new URL(serverUrl);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? require('https') : require('http');
  const postData = JSON.stringify({ folder_path: folderPath, name: productName });

  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + '/projects',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = lib.request(options, function (res) {
    let body = '';
    res.on('data', function (chunk) { body += chunk; });
    res.on('end', function () {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const product = JSON.parse(body);
          console.log('   Product registered with ID: ' + product.id);
          config.product_id = product.id;
          writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
          // Call callback on success
          if (callback) callback();
        } catch (e) {
          // Still call callback even if parsing fails
          if (callback) callback();
        }
      } else {
        console.warn('   Failed to register product: ' + body);
        // Still call callback to continue with publish
        if (callback) callback();
      }
    });
  });

  req.on('error', function (error) {
    console.warn('   Could not connect to server: ' + error.message);
    console.log('   Product created, but not registered with server.');
    // Still call callback to continue with publish even if registration fails
    if (callback) callback();
  });

  req.write(postData);
  req.end();
}
