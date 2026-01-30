import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = process.env.DB_PATH || join(__dirname, '../database.db');

/**
 * Initialize database connection and create tables if they don't exist
 */
export function initDatabase() {
  const db = new Database(DB_PATH);
  
  // Enable foreign keys
  db.pragma('foreign_keys = ON');
  
  // Create tables
  db.exec(`
    -- Projects table
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      folder_path TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      status TEXT DEFAULT 'active'
    );

    -- Edits table (stores HTML content snapshots)
    CREATE TABLE IF NOT EXISTS edits (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      page_path TEXT NOT NULL,
      html_content TEXT NOT NULL,
      edited_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Comments table
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      page_path TEXT NOT NULL,
      x_position REAL NOT NULL,
      y_position REAL NOT NULL,
      comment_text TEXT NOT NULL,
      author TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      resolved INTEGER DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );
    
    -- Migrate existing INTEGER positions to REAL (percentage-based)
    -- This will run if columns are already INTEGER type
    -- Note: SQLite doesn't support ALTER COLUMN, so we'll handle this in application code

    -- Presence table (active users)
    CREATE TABLE IF NOT EXISTS presence (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      page_path TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      last_seen INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Create indexes for performance
    CREATE INDEX IF NOT EXISTS idx_edits_project_page ON edits(project_id, page_path);
    CREATE INDEX IF NOT EXISTS idx_edits_created_at ON edits(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_project_page ON comments(project_id, page_path);
    CREATE INDEX IF NOT EXISTS idx_presence_project_page ON presence(project_id, page_path);
    CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON presence(last_seen);
  `);

  // Clean up stale presence (older than 30 seconds)
  const cleanupStalePresence = db.prepare(`
    DELETE FROM presence WHERE last_seen < ? - 30000
  `);

  // Run cleanup every 30 seconds
  setInterval(() => {
    cleanupStalePresence.run(Date.now());
  }, 30000);

  return db;
}

/**
 * Generate UUID v4
 */
export function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
