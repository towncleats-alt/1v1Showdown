/**
 * backend/start.js — Railway startup wrapper
 * Server starts immediately on 0.0.0.0 so healthcheck passes.
 * Migrations + seed run in background after server is up.
 */
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Start server immediately — healthcheck will pass right away
await import('./server.js');

// Run migrations + seed in background (non-blocking)
setTimeout(() => {
  console.log('[start] Running migrations in background...');
  exec('node backend/db/migrate.js', { cwd: root }, (err, out, errOut) => {
    if (out) console.log(out);
    if (errOut) console.error(errOut);
    if (err) { console.error('[start] Migration error (non-fatal):', err.message); return; }
    console.log('[start] Migrations done. Running seed...');
    exec('node backend/db/seed.js', { cwd: root }, (err2, out2, errOut2) => {
      if (out2) console.log(out2);
      if (errOut2) console.error(errOut2);
      if (err2) console.error('[start] Seed error (non-fatal):', err2.message);
      else console.log('[start] Seed done. Admin user ready.');
    });
  });
}, 2000); // 2s delay to let server fully initialize first
