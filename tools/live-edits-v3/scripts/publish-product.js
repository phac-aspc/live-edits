#!/usr/bin/env node

/**
 * Publish Product Script (CommonJS - works on older Node.js)
 *
 * Usage: node scripts/publish-product.js product-name
 *
 * This script:
 * 1. Fetches latest edits from Azure VM server
 * 2. Reconstructs HTML files with edited content
 * 3. Copies files back to original folder (overwrites)
 * 4. Optionally creates backup before overwriting
 */

const { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, statSync } = require('fs');
const { join, dirname, resolve, relative, basename } = require('path');
const https = require('https');
const http = require('http');

// Configuration
const SERVER_URL = process.env.SERVER_URL || 'http://en.infobase-dev.com/live-edits';
const LIVE_EDITS_FOLDER = '_live-edits';
const PRODUCTS_SUBFOLDER = 'products';
const BACKUP_FOLDER = '_backups';

// Get command line arguments
const productName = process.argv[2];

if (!productName) {
  console.error('Error: Please provide the product name');
  console.log('Usage: node scripts/publish-product.js product-name');
  process.exit(1);
}

var cwdResolved = resolve(process.cwd());
var liveEditsRoot = basename(cwdResolved) === LIVE_EDITS_FOLDER ? cwdResolved : join(cwdResolved, LIVE_EDITS_FOLDER);
const productPath = join(liveEditsRoot, PRODUCTS_SUBFOLDER, productName);
const configPath = join(productPath, '.live-edits', 'config.json');

// Check if product exists
if (!existsSync(productPath)) {
  console.error('Error: Product not found: ' + productPath);
  process.exit(1);
}

// Read config
let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf-8'));
} catch (error) {
  console.error('Error: Could not read config file: ' + configPath);
  process.exit(1);
}

// Support both product_id and project_id for backward compatibility
const productId = config.product_id || config.project_id;
if (!productId) {
  console.error('Error: Product not registered with server. Product ID missing.');
  console.log('   Run setup-product.js again to register the product.');
  process.exit(1);
}

console.log('Publishing product...');
console.log('   Product: ' + productName);
console.log('   Product ID: ' + productId);

// Step 1: Fetch latest edits from server
console.log('Fetching latest edits from server...');
fetchEdits(SERVER_URL, productId, function (err, edits) {
  if (err) {
    console.error('Error fetching edits: ' + err.message);
    console.log('   Make sure the server is running and accessible.');
    process.exit(1);
  }

  if (edits.length === 0) {
    console.log('No edits found. Nothing to publish.');
    process.exit(0);
  }

  console.log('   Retrieved ' + edits.length + ' edited page(s)');

  // Step 2: Create edits map
  const editsMap = {};
  edits.forEach(function (edit) {
    editsMap[edit.page_path] = edit.html_content;
  });

  // Step 3: Find original folder
  // Use source_path from config if available, otherwise fall back to parent directory
  let originalPath;
  if (config.source_path && existsSync(config.source_path)) {
    originalPath = config.source_path;
  } else {
    const parentDir = dirname(liveEditsRoot);
    originalPath = join(parentDir, productName);
  }

  if (!existsSync(originalPath)) {
    console.log('Original folder not found at: ' + originalPath);
    console.log('   Creating it...');
    mkdirSync(originalPath, { recursive: true });
  }

  // Step 4: Create backup
  const backupPath = join(dirname(originalPath), BACKUP_FOLDER, productName, new Date().toISOString().replace(/:/g, '-'));
  console.log('Creating backup at: ' + backupPath);
  mkdirSync(dirname(backupPath), { recursive: true });
  copyFolderRecursive(originalPath, backupPath);
  console.log('   Backup created');

  // Step 5: Process HTML files
  console.log('Applying edits to HTML files...');
  const htmlFiles = findHTMLFiles(productPath);
  let updatedCount = 0;

  var folderPathBase = (config.folder_path || ('/' + LIVE_EDITS_FOLDER + '/' + PRODUCTS_SUBFOLDER + '/' + productName)).replace(/\/$/, '');
  htmlFiles.forEach(function (filePath) {
    const relativePath = relative(productPath, filePath);
    const pagePath = folderPathBase + '/' + relativePath.replace(/\\/g, '/');

    if (editsMap[pagePath]) {
      // The saved edit contains only body.innerHTML, so we need to reconstruct the full HTML
      // Read the template file structure to preserve DOCTYPE, head, etc.
      const originalFilePath = join(originalPath, relativePath);
      let templateFileContent = '';
      
      // Use the file from _live-edits folder as template (it has the full structure)
      // This is better than using the original because it might have been modified
      templateFileContent = readFileSync(filePath, 'utf-8');
      
      // Extract the saved body content
      let savedBodyContent = editsMap[pagePath];
      // Remove editor scripts if they somehow got in there
      savedBodyContent = savedBodyContent.replace(/<script src="[^"]*editor\.js"[^>]*><\/script>\s*/gi, '');
      savedBodyContent = savedBodyContent.replace(/<script[^>]*>[\s\S]*?editor\.js[\s\S]*?<\/script>\s*/gi, '');
      
      // Reconstruct the HTML by replacing the body content
      let reconstructedHTML = templateFileContent;
      
      // Try to replace body content while preserving body tag attributes
      const bodyTagMatch = templateFileContent.match(/<body([^>]*)>([\s\S]*)<\/body>/i);
      if (bodyTagMatch) {
        // Replace body content while keeping body tag and attributes
        const bodyAttributes = bodyTagMatch[1];
        reconstructedHTML = templateFileContent.replace(
          /<body[^>]*>[\s\S]*?<\/body>/i,
          '<body' + bodyAttributes + '>' + savedBodyContent + '</body>'
        );
      } else {
        // Fallback: if no body tag found, this is unusual but handle it
        console.warn('   Warning: No <body> tag found in template file for ' + relativePath);
        // Try to insert before </html>
        if (templateFileContent.indexOf('</html>') !== -1) {
          reconstructedHTML = templateFileContent.replace(/<\/html>/i, '<body>' + savedBodyContent + '</body></html>');
        } else {
          // Last resort: prepend basic HTML structure
          reconstructedHTML = '<!DOCTYPE html>\n<html>\n<head><title>Page</title></head>\n<body>' + savedBodyContent + '</body>\n</html>';
        }
      }
      
      // Remove editor scripts and widget-related scripts from the reconstructed HTML
      reconstructedHTML = reconstructedHTML.replace(/<script src="[^"]*editor\.js"[^>]*><\/script>\s*/gi, '');
      reconstructedHTML = reconstructedHTML.replace(/<script[^>]*>[\s\S]*?editor\.js[\s\S]*?<\/script>\s*/gi, '');
      reconstructedHTML = reconstructedHTML.replace(/<script[^>]*socket\.io[^>]*><\/script>\s*/gi, '');
      // Remove meta tag for live-edits-folder-path
      reconstructedHTML = reconstructedHTML.replace(/<meta[^>]*name=["']live-edits-folder-path["'][^>]*>\s*/gi, '');
      
      const originalDir = dirname(originalFilePath);
      if (!existsSync(originalDir)) mkdirSync(originalDir, { recursive: true });
      writeFileSync(originalFilePath, reconstructedHTML, 'utf-8');
      updatedCount++;
      console.log('   Updated ' + relativePath + ' (reconstructed full HTML)');
    } else {
      let htmlContent = readFileSync(filePath, 'utf-8');
      htmlContent = htmlContent.replace(/<script src="[^"]*editor\.js"[^>]*><\/script>\s*/gi, '');
      htmlContent = htmlContent.replace(/<script[^>]*>[\s\S]*?editor\.js[\s\S]*?<\/script>\s*/gi, '');
      htmlContent = htmlContent.replace(/<script[^>]*socket\.io[^>]*><\/script>\s*/gi, '');
      const originalFilePath = join(originalPath, relativePath);
      const originalDir = dirname(originalFilePath);
      if (!existsSync(originalDir)) mkdirSync(originalDir, { recursive: true });
      writeFileSync(originalFilePath, htmlContent, 'utf-8');
      console.log('   Copied ' + relativePath + ' (no edits)');
    }
  });

  // Step 6: Copy other files
  console.log('Copying other files...');
  copyOtherFiles(productPath, originalPath, htmlFiles);

  console.log('\nPublishing complete!');
  console.log('   Updated ' + updatedCount + ' HTML file(s)');
  console.log('   Backup saved to: ' + backupPath);
  console.log('   Published to: ' + originalPath);
});

// Fetch edits via HTTP/HTTPS (no fetch on old Node)
function fetchEdits(serverUrl, productId, callback) {
  const url = new URL(serverUrl);
  const isHttps = url.protocol === 'https:';
  const lib = isHttps ? https : http;
  
  // Construct the path - if serverUrl already includes /live-edits, don't add it again
  // If pathname is /live-edits, then path should be /live-edits/edits/project/...
  // If pathname is empty or /, then path should be /edits/project/...
  let basePath = url.pathname.replace(/\/$/, '') || '';
  const path = basePath + '/edits/project/' + encodeURIComponent(productId);

  const options = {
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: path,
    method: 'GET'
  };

  console.log('Fetching edits from:', {
    serverUrl: serverUrl,
    hostname: options.hostname,
    port: options.port,
    path: path,
    fullUrl: url.protocol + '//' + options.hostname + (options.port ? ':' + options.port : '') + path
  });

  const req = lib.request(options, function (res) {
    let body = '';
    res.on('data', function (chunk) { body += chunk; });
    res.on('end', function () {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const data = JSON.parse(body);
          console.log('Successfully fetched', Array.isArray(data) ? data.length : 0, 'edit(s)');
          callback(null, Array.isArray(data) ? data : []);
        } catch (e) {
          console.error('Failed to parse response:', e.message);
          console.error('Response body:', body.substring(0, 500));
          callback(new Error('Invalid JSON response'));
        }
      } else {
        console.error('Server returned', res.statusCode);
        console.error('Response body:', body.substring(0, 500));
        callback(new Error('Server returned ' + res.statusCode + (body ? ': ' + body.substring(0, 200) : '')));
      }
    });
  });

  req.on('error', function (error) {
    callback(error);
  });

  req.end();
}

function copyFolderRecursive(src, dest) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src, { withFileTypes: true });

  for (var i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.name === '.live-edits') continue;
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

function copyOtherFiles(srcDir, destDir, excludeFiles) {
  const excludeSet = {};
  excludeFiles.forEach(function (f) {
    excludeSet[resolve(f)] = true;
  });

  function copyRecursive(currentSrc, currentDest) {
    if (!existsSync(currentDest)) {
      mkdirSync(currentDest, { recursive: true });
    }

    const entries = readdirSync(currentSrc, { withFileTypes: true });

    for (var i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.name === '.live-edits') continue;
      const srcPath = join(currentSrc, entry.name);
      const destPath = join(currentDest, entry.name);
      const resolvedSrc = resolve(srcPath);
      if (entry.isDirectory()) {
        copyRecursive(srcPath, destPath);
      } else if (!excludeSet[resolvedSrc]) {
        copyFileSync(srcPath, destPath);
      }
    }
  }

  copyRecursive(srcDir, destDir);
}
