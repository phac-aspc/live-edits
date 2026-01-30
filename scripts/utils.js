import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync } from 'fs';
import { join, dirname, basename, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Get the project root directory (tools/live-edits-v3)
 */
export function getProjectRoot() {
  return resolve(__dirname, '..');
}

/**
 * Read and parse JSON file
 */
export function readJSON(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

/**
 * Write JSON file
 */
export function writeJSON(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Ensure directory exists
 */
export function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Copy file
 */
export function copyFile(src, dest) {
  ensureDir(dirname(dest));
  copyFileSync(src, dest);
}

/**
 * Extract project name from folder path
 */
export function getProjectName(folderPath) {
  return basename(folderPath);
}

/**
 * Get live-edits folder path
 */
export function getLiveEditsFolder() {
  // Assuming _live-edits is in the same parent directory as the source folder
  // This will be customized based on your EC2 structure
  return resolve(process.cwd(), '_live-edits');
}

/**
 * Inject script tag into HTML
 */
export function injectScript(htmlContent, scriptPath) {
  // Try to inject before closing </body> tag
  if (htmlContent.includes('</body>')) {
    return htmlContent.replace(
      '</body>',
      `  <script src="${scriptPath}"></script>\n</body>`
    );
  }
  
  // If no </body>, append to end
  return htmlContent + `\n<script src="${scriptPath}"></script>\n`;
}

/**
 * Find all HTML files in a directory recursively
 */
export function findHTMLFiles(dir, fileList = []) {
  const files = readdirSync(dir);
  
  files.forEach(file => {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    
    if (stat.isDirectory()) {
      findHTMLFiles(filePath, fileList);
    } else if (file.endsWith('.html') || file.endsWith('.htm')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

// Note: readdirSync and statSync need to be imported
import { readdirSync } from 'fs';
