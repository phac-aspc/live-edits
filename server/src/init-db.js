import { loadConfig } from './config.js';
import { initDatabase } from './database.js';

try {
  const config = loadConfig();
  const db = await initDatabase(config);
  db.close();
  console.log(`Database initialized: ${config.dbPath}`);
} catch (error) {
  console.error(`Database initialization failed: ${error.message}`);
  process.exitCode = 1;
}
