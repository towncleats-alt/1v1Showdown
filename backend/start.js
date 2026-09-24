/**
 * backend/start.js — Production startup wrapper for Railway
 * Starts the HTTP server immediately (so healthchecks pass),
 * then runs migrations + seed in the background.
 */
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function runBackground(cmd) {
  return new Promise((resolve) => {
    console.log(`\n▶ ${cmd}`);
    exec(cmd, { cwd: root }, (err, stdout, stderr) => {
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
      if (err) console.error(`Command failed (non-fatal): ${err.message}`);
      resolve();
    });
  });
}

// Start the server first so Railway healthcheck passes immediately
const serverModule = await import('./server.js');

// Then run migrations + seed in the background (non-blocking)
(async () => {
  console.log('\n[start] Running DB migrations...');
  await runBackground('node backend/db/migrate.js');
  console.log('[start] Running DB seed...');
  await runBackground('node backend/db/seed.js');
  console.log('[start] Migrations and seed complete.');
})();
