/**
 * Database Initialization Script
 * 
 * Creates the SQLite database and tables if they don't exist.
 * Run this once before starting the server for the first time.
 * 
 * Usage: npm run init-db
 */

import { initDatabase } from './database.js';

console.log('Initializing database...');

try {
  const db = initDatabase();
  console.log('✅ Database initialized successfully!');
  console.log('📊 Database location:', process.env.DB_PATH || './database.db');
  
  // Test query
  const testQuery = db.prepare('SELECT COUNT(*) as count FROM projects');
  const result = testQuery.get();
  console.log(`📈 Current projects: ${result.count}`);
  
  db.close();
  process.exit(0);
} catch (error) {
  console.error('❌ Error initializing database:', error);
  process.exit(1);
}
