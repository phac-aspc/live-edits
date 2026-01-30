#!/usr/bin/env node

/**
 * Setup Product Script (CommonJS - works on older Node.js)
 *
 * Usage: 
 *   node scripts/setup-product.js /path/to/product-folder
 *   node scripts/setup-product.js /path/to/topic-folder --subfolders product1,product2
 *   node scripts/setup-product.js /path/to/folder --files file1.html,subfolder/file2.html
 *   node scripts/setup-product.js /path/to/folder --subfolders product1 --files product1/index.html
 *
 * This script:
 * 1. Copies the product folder (or selected subfolders/files) to _live-edits/product-name/
 * 2. Injects the editor script into all HTML files
 * 3. Creates .live-edits/config.json
 * 4. Registers the product with the Azure VM server
 */

const {
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  existsSync,
  readdirSync,
  statSync,
  rmSync
} = require('fs');
const { join, basename, resolve, relative, dirname, isAbsolute } = require('path');
const { execSync } = require('child_process');
const https = require('https');
const http = require('http');

// Configuration
const SERVER_URL = process.env.SERVER_URL || 'http://en.infobase-dev.com/live-edits';
const WIDGET_SCRIPT_PATH = '/_live-edits/widget/editor.js'; // Path relative to web root
const LIVE_EDITS_FOLDER = '_live-edits';
const PRODUCTS_SUBFOLDER = 'products';

// Folders to exclude when listing products (internal/utility dirs, not product folders)
const EXCLUDED_LIST_DIRS = ['src', '_config', '_dependencies', '_user', '_util', '_live-edits', 'scripts', 'widget', 'server', 'node_modules'];

// Folders to exclude when copying (unless explicitly specified)
const EXCLUDED_COPY_DIRS = ['archive'];

// Parse command line arguments
let sourceFolder = null;
let subfolders = null;
let files = null;
let listArg = null;

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--list') {
    listArg = process.argv[i + 1] || null;
    break;
  } else if (arg === '--subfolders') {
    subfolders = process.argv[i + 1] ? process.argv[i + 1].split(',').map(s => s.trim()) : [];
    i++;
  } else if (arg === '--files') {
    files = process.argv[i + 1] ? process.argv[i + 1].split(',').map(s => s.trim()) : [];
    i++;
  } else if (!sourceFolder && !arg.startsWith('--')) {
    sourceFolder = arg;
  }
}

// List folders in a directory (help discover product folders)
if (process.argv[2] === '--list') {
  var dirToScan;
  if (listArg) {
    dirToScan = resolve(listArg);
  } else {
    // Default: list from environment root (parent of _live-edits)
    var cwd = resolve(process.cwd());
    var cwdBase = basename(cwd);
    if (cwdBase === LIVE_EDITS_FOLDER) {
      dirToScan = dirname(cwd);
    } else {
      dirToScan = cwd;
    }
  }
  dirToScan = resolve(dirToScan);
  if (!existsSync(dirToScan)) {
    console.error('Error: Directory does not exist: ' + dirToScan);
    process.exit(1);
  }
  const entries = readdirSync(dirToScan, { withFileTypes: true });
  const dirs = entries.filter(function (e) {
    if (!e.isDirectory() || e.name.startsWith('.')) return false;
    return EXCLUDED_LIST_DIRS.indexOf(e.name) === -1;
  }).map(function (e) { return e.name; });
  console.log('\nProduct folders in ' + dirToScan + ':\n');
  if (dirs.length === 0) {
    console.log('   (no product folders found; excluded: ' + EXCLUDED_LIST_DIRS.join(', ') + ')');
  } else {
    dirs.forEach(function (d) { console.log('   - ' + join(dirToScan, d)); });
    console.log('\nEnvironment folder: ' + dirToScan);
    console.log('\nUsage: node scripts/setup-product.js <folder-name>   (e.g. amrnet)');
    console.log('   or: node scripts/setup-product.js "' + join(dirToScan, '<folder-name>') + '"');
  }
  console.log('');
  process.exit(0);
}

if (!sourceFolder) {
  var cwdResolved = resolve(process.cwd());
  var envRoot = basename(cwdResolved) === LIVE_EDITS_FOLDER ? dirname(cwdResolved) : cwdResolved;
  console.error('Error: Please provide the source folder path');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/setup-product.js <product-folder>     (e.g. amrnet, relative to environment)');
  console.log('  node scripts/setup-product.js "' + join(envRoot, '<folder-name>') + '"');
  console.log('');
  console.log('Selective copying options:');
  console.log('  --subfolders <folder1,folder2,...>   Copy only specified subfolders');
  console.log('  --files <file1.html,path/file2.html> Copy only specified HTML files');
  console.log('  (Both options can be combined)');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/setup-product.js /path/to/topic-folder --subfolders product1,product2');
  console.log('  node scripts/setup-product.js /path/to/folder --files index.html,about/index.html');
  console.log('  node scripts/setup-product.js /path/to/folder --subfolders product1 --files product1/index.html');
  console.log('');
  console.log('Product source folder (environment root): ' + envRoot);
  console.log('');
  console.log('To list product folders:');
  console.log('  node scripts/setup-product.js --list');
  console.log('');
  console.log('Current working directory:', process.cwd());
  process.exit(1);
}

// Environment root = parent of _live-edits when running from _live-edits
var cwdResolved = resolve(process.cwd());
var envRoot = basename(cwdResolved) === LIVE_EDITS_FOLDER ? dirname(cwdResolved) : cwdResolved;
// Resolve source: if not absolute, treat as relative to environment root
var sourcePath = isAbsolute(sourceFolder) ? resolve(sourceFolder) : resolve(join(envRoot, sourceFolder));
var productName = basename(sourcePath);
// _live-edits root: use cwd when already inside _live-edits, else cwd/_live-edits
var liveEditsRoot = basename(cwdResolved) === LIVE_EDITS_FOLDER ? cwdResolved : join(cwdResolved, LIVE_EDITS_FOLDER);
var targetPath = join(liveEditsRoot, PRODUCTS_SUBFOLDER, productName);

// Check if source folder exists
if (!existsSync(sourcePath)) {
  console.error('Error: Source folder does not exist: ' + sourcePath);
  console.error('');
  console.error('Resolved from:', sourceFolder);
  console.error('Current working directory:', process.cwd());
  console.error('');
  console.error('Tip: Use --list to see folders in the current directory:');
  console.error('  node scripts/setup-product.js --list');
  console.error('  node scripts/setup-product.js --list /path/to/parent');
  process.exit(1);
}

console.log('Setting up Live Edits product...');
console.log('   Source: ' + sourcePath);
console.log('   Target: ' + targetPath);
if (subfolders && subfolders.length > 0) {
  console.log('   Subfolders: ' + subfolders.join(', '));
}
if (files && files.length > 0) {
  console.log('   Files: ' + files.join(', '));
}

// Step 1: Create _live-edits and _live-edits/products if they don't exist
if (!existsSync(liveEditsRoot)) {
  console.log('Creating ' + LIVE_EDITS_FOLDER + ' directory...');
  mkdirSync(liveEditsRoot, { recursive: true });
}
var productsDir = join(liveEditsRoot, PRODUCTS_SUBFOLDER);
if (!existsSync(productsDir)) {
  mkdirSync(productsDir, { recursive: true });
}

// Step 2: Copy folder (remove target if exists)
if (existsSync(targetPath)) {
  console.log('Target folder already exists. Removing...');
  try {
    rmSync(targetPath, { recursive: true, force: true });
  } catch (e) {
    var isWin = process.platform === 'win32';
    execSync(isWin ? 'rmdir /s /q "' + targetPath + '"' : 'rm -rf "' + targetPath + '"', { stdio: 'inherit' });
  }
}

console.log('Copying files...');
if (subfolders && subfolders.length > 0) {
  // Copy specified subfolders (archive is allowed if explicitly specified)
  subfolders.forEach(function (subfolder) {
    const srcSubfolder = join(sourcePath, subfolder);
    const destSubfolder = join(targetPath, subfolder);
    if (!existsSync(srcSubfolder)) {
      console.warn('   Warning: Subfolder does not exist: ' + subfolder);
      return;
    }
    const stat = statSync(srcSubfolder);
    if (!stat.isDirectory()) {
      console.warn('   Warning: Not a directory: ' + subfolder);
      return;
    }
    copyFolderRecursive(srcSubfolder, destSubfolder, subfolders);
    console.log('   Copied subfolder: ' + subfolder);
  });
}

if (files && files.length > 0) {
  // Copy specified files (can be combined with subfolders)
  files.forEach(function (file) {
    const srcFile = join(sourcePath, file);
    const destFile = join(targetPath, file);
    if (!existsSync(srcFile)) {
      console.warn('   Warning: File does not exist: ' + file);
      return;
    }
    const stat = statSync(srcFile);
    if (stat.isDirectory()) {
      console.warn('   Warning: Expected file but found directory: ' + file);
      return;
    }
    // Ensure destination directory exists
    const destDir = dirname(destFile);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }
    copyFileSync(srcFile, destFile);
    console.log('   Copied file: ' + file);
  });
}

if (!subfolders && !files) {
  // Copy everything (default behavior, excluding archive folders)
  copyFolderRecursive(sourcePath, targetPath, null);
}

// Step 3: Find and inject script into HTML files; add class="editable" to <main>
console.log('Injecting editor script into HTML files...');
const htmlFiles = findHTMLFiles(targetPath);
let injectedCount = 0;
let dynamicMarkedCount = 0;
var folderPathForMeta = '/' + LIVE_EDITS_FOLDER + '/' + PRODUCTS_SUBFOLDER + '/' + productName;

htmlFiles.forEach(function (filePath) {
  try {
    let htmlContent = readFileSync(filePath, 'utf-8');
    htmlContent = addEditableToMain(htmlContent);
    
    // Detect and mark dynamic content
    var result = markDynamicContentInHTML(htmlContent);
    htmlContent = result.html;
    if (result.count > 0) {
      dynamicMarkedCount += result.count;
      console.log('   Marked ' + result.count + ' dynamic element(s) in ' + relative(targetPath, filePath));
    }

    if (htmlContent.includes('editor.js') && htmlContent.includes('socket.io')) {
      htmlContent = injectMetaTag(htmlContent, folderPathForMeta);
      writeFileSync(filePath, htmlContent, 'utf-8');
      console.log('   Added editable to <main>: ' + relative(targetPath, filePath));
      return;
    }

    const updatedContent = injectScript(htmlContent, WIDGET_SCRIPT_PATH, folderPathForMeta);
    writeFileSync(filePath, updatedContent, 'utf-8');
    injectedCount++;
    console.log('   Injected into ' + relative(targetPath, filePath));
  } catch (error) {
    console.error('   Error processing ' + filePath + ':', error.message);
  }
});

if (dynamicMarkedCount > 0) {
  console.log('   Marked ' + dynamicMarkedCount + ' dynamic content element(s) total');
}

console.log('   Injected script into ' + injectedCount + ' HTML file(s)');

// Step 4: Create .live-edits directory and config
const liveEditsConfigDir = join(targetPath, '.live-edits');
if (!existsSync(liveEditsConfigDir)) {
  mkdirSync(liveEditsConfigDir, { recursive: true });
}

var folderPath = '/' + LIVE_EDITS_FOLDER + '/' + PRODUCTS_SUBFOLDER + '/' + productName;
const config = {
  product_name: productName,
  folder_path: folderPath,
  created_at: new Date().toISOString(),
  server_url: SERVER_URL,
  source_path: sourcePath,
  selective_copy: {
    subfolders: subfolders || null,
    files: files || null
  }
};

const configPath = join(liveEditsConfigDir, 'config.json');
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
console.log('   Created config: ' + relative(targetPath, configPath));

// Step 5: Register product with server
console.log('Registering product with server...');
registerProduct(SERVER_URL, folderPath, productName, config, configPath);

console.log('\nProduct setup complete!');
console.log('\nNext steps:');
console.log('   1. Make sure the widget script is accessible at: ' + WIDGET_SCRIPT_PATH);
console.log('   2. Share the preview URL with your client');
console.log('   3. When ready, run: node scripts/publish-product.js ' + productName);

// Helper: HTTP/HTTPS request (no fetch on old Node)
function registerProduct(serverUrl, folderPath, productName, config, configPath) {
  const url = new URL(serverUrl);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;
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
        } catch (e) {}
      } else {
        console.warn('   Failed to register product: ' + body);
      }
    });
  });

  req.on('error', function (error) {
    console.warn('   Could not connect to server: ' + error.message);
    console.log('   Product setup complete, but not registered with server.');
  });

  req.write(postData);
  req.end();
}

function copyFolderRecursive(src, dest, allowedSubfolders) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src, { withFileTypes: true });

  for (var i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const entryName = entry.name;
    const srcPath = join(src, entryName);
    const destPath = join(dest, entryName);

    if (entry.isDirectory()) {
      // Skip excluded folders (like "archive") unless explicitly allowed
      if (EXCLUDED_COPY_DIRS.indexOf(entryName.toLowerCase()) !== -1) {
        // Check if this folder is explicitly allowed in the allowedSubfolders list
        var isAllowed = false;
        if (allowedSubfolders) {
          // Check if any allowed subfolder path contains this folder name
          for (var j = 0; j < allowedSubfolders.length; j++) {
            var allowedPath = allowedSubfolders[j];
            // Check if the allowed path starts with this folder name (e.g., "archive" or "archive/subfolder")
            if (allowedPath.toLowerCase() === entryName.toLowerCase() || 
                allowedPath.toLowerCase().startsWith(entryName.toLowerCase() + '/')) {
              isAllowed = true;
              break;
            }
          }
        }
        if (!isAllowed) {
          console.log('   Skipping excluded folder: ' + entryName);
          continue;
        }
      }
      copyFolderRecursive(srcPath, destPath, allowedSubfolders);
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
    const stat = statSync(filePath);

    if (stat.isDirectory() && filePath.indexOf('.live-edits') === -1) {
      findHTMLFiles(filePath, fileList);
    } else if (file.endsWith('.html') || file.endsWith('.htm')) {
      fileList.push(filePath);
    }
  }

  return fileList;
}

/**
 * Detects and marks dynamically generated content in HTML.
 * Adds "dynamic-content" class to elements that are likely generated by JavaScript.
 * 
 * Detection patterns:
 * 1. Explicit data-dynamic attributes (always marked)
 * 2. Data attributes indicating generation (data-generated, data-auto-generated, data-js)
 * 3. Class names containing "dynamic", "generated", or starting with "js-" (only if also editable)
 * 4. Empty editable elements in common content tags (likely to be populated by JS)
 * 
 * Returns an object with the modified HTML and count of marked elements.
 */
function markDynamicContentInHTML(htmlContent) {
  var markedCount = 0;
  
  // Pattern 1: Elements with explicit data-dynamic attribute (always mark - explicit intent)
  // Skip SVG elements and elements inside SVG
  htmlContent = htmlContent.replace(/<(\w+)([^>]*)\s+data-dynamic\s*=\s*["']?([^"'\s>]*)["']?([^>]*)>/gi, function (match, tag, before, value, after) {
    // Skip SVG elements
    if (tag.toLowerCase() === 'svg' || before.toLowerCase().indexOf('xmlns="http://www.w3.org/2000/svg"') !== -1) {
      return match;
    }
    var allAttrs = before + after;
    var result = addDynamicContentClass(match, tag, allAttrs);
    if (result !== match) markedCount++;
    return result;
  });
  
  // Pattern 2: Elements with data-generated, data-auto-generated, data-js attributes (always mark)
  htmlContent = htmlContent.replace(/<(\w+)([^>]*)\s+data-(?:generated|auto-generated|js)\s*=\s*["']([^"']*)["']([^>]*)>/gi, function (match, tag, before, value, after) {
    // Skip SVG elements
    if (tag.toLowerCase() === 'svg' || before.toLowerCase().indexOf('xmlns="http://www.w3.org/2000/svg"') !== -1) {
      return match;
    }
    var allAttrs = before + after;
    var result = addDynamicContentClass(match, tag, allAttrs);
    if (result !== match) markedCount++;
    return result;
  });
  
  // Pattern 3: Elements with classes containing "dynamic", "generated", or starting with "js-"
  // Only mark if they also have "editable" class
  htmlContent = htmlContent.replace(/<(\w+)([^>]*)\s+class\s*=\s*["']([^"']*(?:dynamic|generated|js-)[^"']*)["']([^>]*)>/gi, function (match, tag, before, classes, after) {
    // Skip SVG elements
    if (tag.toLowerCase() === 'svg' || before.toLowerCase().indexOf('xmlns="http://www.w3.org/2000/svg"') !== -1) {
      return match;
    }
    // Only mark if it also has "editable" class and doesn't already have "dynamic-content"
    if (classes.indexOf('editable') !== -1 && classes.indexOf('dynamic-content') === -1) {
      var newClasses = classes.trim() + ' dynamic-content';
      markedCount++;
      return '<' + tag + before + ' class="' + newClasses + '"' + after + '>';
    }
    return match;
  });
  
  // Pattern 4: Empty editable elements that might be populated by JS
  // Look for empty spans, divs, p tags with editable class
  htmlContent = htmlContent.replace(/<(\w+)([^>]*)\s+class\s*=\s*["']([^"']*editable[^"']*)["']([^>]*)>\s*<\/\1>/gi, function (match, tag, before, classes, after) {
    // Skip SVG elements and SVG namespace elements
    if (tag.toLowerCase() === 'svg' || 
        before.toLowerCase().indexOf('xmlns="http://www.w3.org/2000/svg"') !== -1 ||
        ['path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'text', 'g', 'defs', 'use'].indexOf(tag.toLowerCase()) !== -1) {
      return match;
    }
    // Only mark if it doesn't already have dynamic-content and is a common content tag
    if (classes.indexOf('dynamic-content') === -1 && (tag === 'span' || tag === 'div' || tag === 'p' || tag === 'td' || tag === 'th')) {
      var newClasses = classes.trim() + ' dynamic-content';
      markedCount++;
      return '<' + tag + before + ' class="' + newClasses + '"' + after + '></' + tag + '>';
    }
    return match;
  });
  
  return { html: htmlContent, count: markedCount };
}

/**
 * Helper function to add "dynamic-content" class to an HTML element.
 * Handles cases where class attribute exists or doesn't exist.
 * Returns the modified HTML string.
 */
function addDynamicContentClass(originalMatch, tag, attributes) {
  // Check if dynamic-content already exists in the match
  if (originalMatch.indexOf('dynamic-content') !== -1) {
    return originalMatch;
  }
  
  // Check if class attribute already exists
  var classMatch = attributes.match(/\s+class\s*=\s*["']([^"']*)["']/i);
  
  if (classMatch) {
    var existingClasses = classMatch[1];
    // Check if dynamic-content already exists
    if (existingClasses.indexOf('dynamic-content') === -1) {
      var newClasses = existingClasses.trim() + ' dynamic-content';
      return originalMatch.replace(/\s+class\s*=\s*["'][^"']*["']/i, ' class="' + newClasses + '"');
    }
    return originalMatch;
  } else {
    // No class attribute, add one before the closing >
    // Find the position before the closing > or />
    var lastBracket = originalMatch.lastIndexOf('>');
    if (lastBracket !== -1) {
      return originalMatch.substring(0, lastBracket) + ' class="dynamic-content"' + originalMatch.substring(lastBracket);
    }
    // Fallback: append before closing tag
    return originalMatch.replace(/>$/, ' class="dynamic-content">');
  }
}

/**
 * Ensures <main> has class="editable" so the widget makes it editable.
 * Handles: <main>, <main class="...">, <main other="attrs">.
 */
function addEditableToMain(htmlContent) {
  if (!htmlContent.match(/<main[\s>]/i)) return htmlContent;
  // 1. <main class="..."> -> add "editable" to class if not present
  var out = htmlContent.replace(/<main\s+class="([^"]*)"/gi, function (match, cls) {
    if (cls.indexOf('editable') !== -1) return match;
    return '<main class="' + cls.trim() + ' editable"';
  });
  // 2. <main> (no attributes)
  out = out.replace(/<main>/gi, '<main class="editable">');
  // 3. <main ...> with other attributes but no class
  out = out.replace(/<main\s+(?![^>]*\bclass=)[^>]*>/gi, function (match) {
    return '<main class="editable" ' + match.slice(5).trim();
  });
  return out;
}

/**
 * Injects <meta name="live-edits-folder-path" content="..."> so the widget can detect product
 * when the page URL does not contain _live-edits (e.g. alternate routes).
 */
function injectMetaTag(htmlContent, folderPath) {
  var meta = '<meta name="live-edits-folder-path" content="' + folderPath + '">';
  if (htmlContent.indexOf('live-edits-folder-path') !== -1) return htmlContent;
  if (htmlContent.indexOf('</head>') !== -1) {
    return htmlContent.replace('</head>', '  ' + meta + '\n</head>');
  }
  return meta + '\n' + htmlContent;
}

function injectScript(htmlContent, scriptPath, folderPath) {
  const socketIOScript = '<script src="https://cdn.socket.io/4.8.1/socket.io.min.js"></script>';
  const editorScript = '<script src="' + scriptPath + '" data-live-edits-folder-path="' + (folderPath || '') + '"></script>';

  if (htmlContent.includes('socket.io.min.js') && htmlContent.includes('editor.js')) {
    return injectMetaTag(htmlContent, folderPath || '');
  }

  var withMeta = injectMetaTag(htmlContent, folderPath || '');

  if (withMeta.includes('</body>')) {
    let cleaned = withMeta.replace(/<script src="[^"]*editor\.js"[^>]*><\/script>\s*/gi, '');
    cleaned = cleaned.replace(/<script[^>]*socket\.io[^>]*><\/script>\s*/gi, '');
    return cleaned.replace('</body>', '  ' + socketIOScript + '\n  ' + editorScript + '\n</body>');
  }

  return withMeta + '\n' + socketIOScript + '\n' + editorScript + '\n';
}
