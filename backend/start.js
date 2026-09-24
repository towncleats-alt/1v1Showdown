/**
 * backend/start.js — Production startup wrapper for Railway
 * Runs migrations + seed first, then starts the server.
 * This runs at container start time when the internal network is available.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function run(cmd) {
  console.log(`\n▶ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
}

try {
  run('node backend/db/migrate.js');
} catch (e) {
  console.error('Migration failed — continuing anyway (may already be up to date)');
}

try {
  run('node backend/db/seed.js');
} catch (e) {
  console.error('Seed failed — continuing anyway (admin may already exist)');
}

// Start the server — import so it shares the same process
await import('./server.js');
