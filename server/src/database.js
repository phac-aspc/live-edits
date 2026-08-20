import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function tableColumns(db, name) {
  return tableExists(db, name) ? db.pragma(`table_info(${name})`).map(({ name: column }) => column) : [];
}

async function archiveLegacySchema(db, dbPath) {
  if (!tableExists(db, 'projects') || tableColumns(db, 'projects').includes('site_key')) return;
  if (tableExists(db, 'legacy_projects_v3')) {
    throw new Error('Both legacy and version 4 tables exist. Restore the database backup and resolve the migration manually.');
  }

  const backupPath = `${dbPath}.v3-backup-${new Date().toISOString().replaceAll(':', '-')}`;
  await db.backup(backupPath);
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    for (const table of ['projects', 'edits', 'comments', 'presence']) {
      if (tableExists(db, table)) db.exec(`ALTER TABLE ${table} RENAME TO legacy_${table}_v3`);
    }
  })();
  db.pragma('foreign_keys = ON');
  console.warn(`Version 3 tables were archived in place. Database backup: ${backupPath}`);
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      site_key TEXT NOT NULL CHECK (site_key IN ('en', 'fr')),
      project_path TEXT NOT NULL,
      name TEXT NOT NULL,
      origin TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      review_status TEXT NOT NULL DEFAULT 'open' CHECK (review_status IN ('open', 'closed')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (site_key, project_path)
    );

    CREATE TABLE IF NOT EXISTS edits (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      page_path TEXT NOT NULL,
      manifest_hash TEXT NOT NULL,
      payload_version INTEGER NOT NULL,
      payload TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      edited_by TEXT NOT NULL,
      edited_email TEXT,
      revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      published_at INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE (project_id, page_path, revision)
    );

    CREATE TABLE IF NOT EXISTS project_pages (
      project_id TEXT NOT NULL,
      page_path TEXT NOT NULL,
      manifest_hash TEXT NOT NULL,
      element_keys TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (project_id, page_path),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      page_path TEXT NOT NULL,
      element_key TEXT NOT NULL,
      offset_x REAL NOT NULL CHECK (offset_x BETWEEN 0 AND 1),
      offset_y REAL NOT NULL CHECK (offset_y BETWEEN 0 AND 1),
      comment_text TEXT NOT NULL,
      author TEXT NOT NULL,
      author_email TEXT,
      resolved INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS publish_events (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL,
      published_by TEXT NOT NULL,
      pages TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS v4_edits_project_page_revision
      ON edits(project_id, page_path, revision DESC);
    CREATE INDEX IF NOT EXISTS v4_edits_unpublished
      ON edits(project_id, published_at, page_path);
    CREATE INDEX IF NOT EXISTS v4_comments_project_page
      ON comments(project_id, page_path, resolved, created_at);
  `);
  if (!tableColumns(db, 'edits').includes('manifest_hash')) {
    db.exec("ALTER TABLE edits ADD COLUMN manifest_hash TEXT NOT NULL DEFAULT 'legacy'");
  }
  if (!tableColumns(db, 'projects').includes('review_status')) {
    db.exec("ALTER TABLE projects ADD COLUMN review_status TEXT NOT NULL DEFAULT 'open' CHECK (review_status IN ('open', 'closed'))");
  }
  if (!tableColumns(db, 'edits').includes('edited_email')) {
    db.exec('ALTER TABLE edits ADD COLUMN edited_email TEXT');
  }
  if (!tableColumns(db, 'comments').includes('author_email')) {
    db.exec('ALTER TABLE comments ADD COLUMN author_email TEXT');
  }
  if (!tableColumns(db, 'publish_events').includes('operation_id')) {
    db.exec('ALTER TABLE publish_events ADD COLUMN operation_id TEXT');
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS v4_publish_events_operation
      ON publish_events(operation_id);
    CREATE INDEX IF NOT EXISTS v4_publish_events_project
      ON publish_events(project_id, created_at DESC);
  `);
  db.pragma('user_version = 4');
}

export async function initDatabase(config) {
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const existed = existsSync(config.dbPath);
  const db = new Database(config.dbPath);
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  if (existed) await archiveLegacySchema(db, config.dbPath);
  createSchema(db);
  db.prepare('SELECT 1').get();
  return db;
}

export function generateId() {
  return randomUUID();
}
