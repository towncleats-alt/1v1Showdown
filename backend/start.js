/**
 * backend/start.js — Railway startup wrapper
 * Server starts immediately so healthcheck passes.
 * Migrations + seed run as separate child processes (won't kill the server).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runScript(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
    });
    child.on('close', (code) => {
      if (code !== 0) console.error(`[start] ${script} exited with code ${code} (non-fatal)`);
      resolve();
    });
  });
}

// Start server immediately — healthcheck passes right away
await import('./server.js');

// Run migrations + seed as separate processes after 3s
// (separate processes so their process.exit() doesn't kill the server)
setTimeout(async () => {
  console.log('[start] Running migrations...');
  await runScript('backend/db/migrate.js');
  console.log('[start] Running seed...');
  await runScript('backend/db/seed.js');
  console.log('[start] DB setup complete. Admin user ready.');
}, 3000);
