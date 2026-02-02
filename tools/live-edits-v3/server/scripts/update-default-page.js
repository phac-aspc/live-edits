#!/usr/bin/env node

/**
 * Script to update the default_page for a project in the database
 * 
 * Usage:
 *   node scripts/update-default-page.js <projectId> <pagePath>
 *   node scripts/update-default-page.js --by-path <folderPath> <pagePath>
 * 
 * Examples:
 *   node scripts/update-default-page.js abc123-def456-... /clinical-data.html
 *   node scripts/update-default-page.js --by-path /_live-edits/products/test-product /clinical-data.html
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '../database.db');

if (!existsSync(DB_PATH)) {
  console.error(`❌ Database not found at: ${DB_PATH}`);
  console.error('   Make sure DB_PATH is set correctly or the database exists.');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

const [,, ...args] = process.argv;

if (args.length < 2) {
  console.log('Usage:');
  console.log('  node scripts/update-default-page.js <projectId> <pagePath>');
  console.log('  node scripts/update-default-page.js --by-path <folderPath> <pagePath>');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/update-default-page.js abc123-def456-... /clinical-data.html');
  console.log('  node scripts/update-default-page.js --by-path /_live-edits/products/test-product /clinical-data.html');
  process.exit(1);
}

try {
  let projectId = null;
  let folderPath = null;
  let pagePath = args[args.length - 1]; // Last argument is always the page path

  if (args[0] === '--by-path') {
    // Update by folder path
    folderPath = args[1];
    
    if (!folderPath || !pagePath) {
      console.error('❌ Both folder path and page path are required when using --by-path');
      process.exit(1);
    }

    // Normalize folder path
    let normalizedPath = folderPath.replace(/\.\./g, '');
    normalizedPath = normalizedPath.replace(/[<>:"|?*\x00-\x1f]/g, '');
    normalizedPath = normalizedPath.replace(/\\/g, '/');
    normalizedPath = normalizedPath.replace(/\/+/g, '/');
    normalizedPath = normalizedPath.replace(/^\/+|\/+$/g, '');
    if (!normalizedPath.startsWith('/')) {
      normalizedPath = '/' + normalizedPath;
    }

    // Find project
    const getProject = db.prepare('SELECT * FROM projects WHERE folder_path = ? OR folder_path = ?');
    const project = getProject.get(normalizedPath, normalizedPath.startsWith('/') ? normalizedPath.slice(1) : '/' + normalizedPath);

    if (!project) {
      console.error(`❌ Project not found with path: ${folderPath}`);
      process.exit(1);
    }

    projectId = project.id;
    console.log(`📋 Found project: ${project.name} (ID: ${project.id})`);
    console.log(`   Current default_page: ${project.default_page || '/index.html'}`);
  } else {
    // Update by project ID
    projectId = args[0];
    
    if (!projectId || !pagePath) {
      console.error('❌ Both project ID and page path are required');
      process.exit(1);
    }

    // Check if project exists
    const getProject = db.prepare('SELECT * FROM projects WHERE id = ?');
    const project = getProject.get(projectId);

    if (!project) {
      console.error(`❌ Project not found: ${projectId}`);
      process.exit(1);
    }

    console.log(`📋 Found project: ${project.name} (${project.folder_path})`);
    console.log(`   Current default_page: ${project.default_page || '/index.html'}`);
  }

  // Normalize page path (ensure it starts with /)
  const normalizedPage = pagePath.startsWith('/') ? pagePath : '/' + pagePath;

  // Update default_page
  const update = db.prepare(`
    UPDATE projects 
    SET default_page = ?, updated_at = ?
    WHERE id = ?
  `);
  const result = update.run(normalizedPage, Date.now(), projectId);

  if (result.changes === 0) {
    console.error('❌ Failed to update project');
    process.exit(1);
  }

  // Get updated project
  const getProject = db.prepare('SELECT * FROM projects WHERE id = ?');
  const updatedProject = getProject.get(projectId);

  console.log(`✅ Updated default_page to: ${normalizedPage}`);
  console.log(`   Project: ${updatedProject.name}`);
  console.log(`   Folder: ${updatedProject.folder_path}`);
  console.log(`   Full URL: ${updatedProject.folder_path}${normalizedPage}`);
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
} finally {
  db.close();
}
