#!/usr/bin/env node

/**
 * Simple script to delete entries from the live-edits database
 * 
 * Usage:
 *   node scripts/delete-entry.js project <projectId>
 *   node scripts/delete-entry.js project-by-path <folderPath>
 *   node scripts/delete-entry.js edit <editId>
 *   node scripts/delete-entry.js edits-for-page <projectId> <pagePath>
 *   node scripts/delete-entry.js comment <commentId>
 * 
 * Examples:
 *   node scripts/delete-entry.js project abc123-def456-...
 *   node scripts/delete-entry.js project-by-path /_live-edits/products/myproduct
 *   node scripts/delete-entry.js edit xyz789-abc123-...
 *   node scripts/delete-entry.js edits-for-page abc123-def456-... /index.html
 *   node scripts/delete-entry.js comment comment-id-here
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database is at server/database.db (same level as scripts folder)
const DB_PATH = process.env.DB_PATH || join(__dirname, '../database.db');

if (!existsSync(DB_PATH)) {
  console.error(`❌ Database not found at: ${DB_PATH}`);
  console.error('   Make sure DB_PATH is set correctly or the database exists.');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

const [,, type, ...args] = process.argv;

if (!type || args.length === 0) {
  console.log('Usage:');
  console.log('  node scripts/delete-entry.js project <projectId>');
  console.log('  node scripts/delete-entry.js project-by-path <folderPath>');
  console.log('  node scripts/delete-entry.js edit <editId>');
  console.log('  node scripts/delete-entry.js edits-for-page <projectId> <pagePath>');
  console.log('  node scripts/delete-entry.js comment <commentId>');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/delete-entry.js project abc123-def456-...');
  console.log('  node scripts/delete-entry.js project-by-path /_live-edits/products/myproduct');
  console.log('  node scripts/delete-entry.js edit xyz789-abc123-...');
  console.log('  node scripts/delete-entry.js edits-for-page abc123-def456-... /index.html');
  console.log('  node scripts/delete-entry.js comment comment-id-here');
  process.exit(1);
}

try {
  switch (type) {
    case 'project': {
      const [projectId] = args;
      if (!projectId) {
        console.error('❌ Project ID is required');
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

      // Count related records
      const countEdits = db.prepare('SELECT COUNT(*) as count FROM edits WHERE project_id = ?').get(projectId);
      const countComments = db.prepare('SELECT COUNT(*) as count FROM comments WHERE project_id = ?').get(projectId);
      const countPresence = db.prepare('SELECT COUNT(*) as count FROM presence WHERE project_id = ?').get(projectId);

      console.log(`   - Edits: ${countEdits.count}`);
      console.log(`   - Comments: ${countComments.count}`);
      console.log(`   - Presence records: ${countPresence.count}`);

      // Delete project (CASCADE will delete related records)
      const deleteProject = db.prepare('DELETE FROM projects WHERE id = ?');
      const result = deleteProject.run(projectId);

      console.log(`✅ Deleted project and all related data (${result.changes} project(s) deleted)`);
      break;
    }

    case 'project-by-path': {
      const [folderPath] = args;
      if (!folderPath) {
        console.error('❌ Folder path is required');
        process.exit(1);
      }

      // Normalize path
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
      let project = getProject.get(normalizedPath, normalizedPath.startsWith('/') ? normalizedPath.slice(1) : '/' + normalizedPath);

      if (!project) {
        console.error(`❌ Project not found with path: ${folderPath}`);
        process.exit(1);
      }

      console.log(`📋 Found project: ${project.name} (ID: ${project.id})`);

      // Count related records
      const countEdits = db.prepare('SELECT COUNT(*) as count FROM edits WHERE project_id = ?').get(project.id);
      const countComments = db.prepare('SELECT COUNT(*) as count FROM comments WHERE project_id = ?').get(project.id);
      const countPresence = db.prepare('SELECT COUNT(*) as count FROM presence WHERE project_id = ?').get(project.id);

      console.log(`   - Edits: ${countEdits.count}`);
      console.log(`   - Comments: ${countComments.count}`);
      console.log(`   - Presence records: ${countPresence.count}`);

      // Delete project
      const deleteProject = db.prepare('DELETE FROM projects WHERE id = ?');
      const result = deleteProject.run(project.id);

      console.log(`✅ Deleted project and all related data (${result.changes} project(s) deleted)`);
      break;
    }

    case 'edit': {
      const [editId] = args;
      if (!editId) {
        console.error('❌ Edit ID is required');
        process.exit(1);
      }

      // Check if edit exists
      const getEdit = db.prepare('SELECT * FROM edits WHERE id = ?');
      const edit = getEdit.get(editId);

      if (!edit) {
        console.error(`❌ Edit not found: ${editId}`);
        process.exit(1);
      }

      console.log(`📋 Found edit: ${edit.page_path} (Project: ${edit.project_id})`);

      // Delete edit
      const deleteEdit = db.prepare('DELETE FROM edits WHERE id = ?');
      const result = deleteEdit.run(editId);

      console.log(`✅ Deleted edit (${result.changes} edit(s) deleted)`);
      break;
    }

    case 'edits-for-page': {
      const [projectId, pagePath] = args;
      if (!projectId || !pagePath) {
        console.error('❌ Project ID and page path are required');
        process.exit(1);
      }

      // Normalize page path
      let normalizedPath = pagePath.replace(/\.\./g, '');
      normalizedPath = normalizedPath.replace(/[<>:"|?*\x00-\x1f]/g, '');
      normalizedPath = normalizedPath.replace(/\\/g, '/');
      normalizedPath = normalizedPath.replace(/\/+/g, '/');
      if (!normalizedPath.startsWith('/')) {
        normalizedPath = '/' + normalizedPath;
      }

      // Count edits
      const countEdits = db.prepare('SELECT COUNT(*) as count FROM edits WHERE project_id = ? AND page_path = ?').get(projectId, normalizedPath);
      
      if (countEdits.count === 0) {
        // Try without leading slash
        const countAlt = db.prepare('SELECT COUNT(*) as count FROM edits WHERE project_id = ? AND page_path = ?').get(projectId, normalizedPath.slice(1));
        if (countAlt.count === 0) {
          console.error(`❌ No edits found for project ${projectId} and page ${pagePath}`);
          process.exit(1);
        }
        normalizedPath = normalizedPath.slice(1);
      }

      console.log(`📋 Found ${countEdits.count || db.prepare('SELECT COUNT(*) as count FROM edits WHERE project_id = ? AND page_path = ?').get(projectId, normalizedPath).count} edit(s) for page: ${normalizedPath}`);

      // Delete edits
      const deleteEdits = db.prepare('DELETE FROM edits WHERE project_id = ? AND page_path = ?');
      const result = deleteEdits.run(projectId, normalizedPath);

      console.log(`✅ Deleted ${result.changes} edit(s)`);
      break;
    }

    case 'comment': {
      const [commentId] = args;
      if (!commentId) {
        console.error('❌ Comment ID is required');
        process.exit(1);
      }

      // Check if comment exists
      const getComment = db.prepare('SELECT * FROM comments WHERE id = ?');
      const comment = getComment.get(commentId);

      if (!comment) {
        console.error(`❌ Comment not found: ${commentId}`);
        process.exit(1);
      }

      console.log(`📋 Found comment: ${comment.comment_text.substring(0, 50)}... (Page: ${comment.page_path})`);

      // Delete comment
      const deleteComment = db.prepare('DELETE FROM comments WHERE id = ?');
      const result = deleteComment.run(commentId);

      console.log(`✅ Deleted comment (${result.changes} comment(s) deleted)`);
      break;
    }

    default:
      console.error(`❌ Unknown type: ${type}`);
      console.error('   Valid types: project, project-by-path, edit, edits-for-page, comment');
      process.exit(1);
  }
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
} finally {
  db.close();
}
