#!/usr/bin/env node
/**
 * scripts/inject-api-url.js
 *
 * Netlify build script — runs once at deploy time.
 * Replaces the __API_URL__ placeholder in every HTML file under frontend/
 * with the real backend URL from the API_URL environment variable.
 *
 * Set API_URL in Netlify → Site configuration → Environment variables.
 * Example value: https://your-app.onrender.com
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const frontendDir = resolve(__dirname, '../frontend');

const apiUrl = (process.env.API_URL || '').trim().replace(/\/$/, '');

if (!apiUrl) {
  console.warn(
    '[inject-api-url] WARNING: API_URL environment variable is not set.\n' +
    '  The frontend will use same-origin /api/tournament (Netlify proxy).\n' +
    '  This is fine if you have the [[redirects]] proxy configured in netlify.toml.'
  );
}

const htmlFiles = readdirSync(frontendDir).filter(f => f.endsWith('.html'));

for (const file of htmlFiles) {
  const filePath = join(frontendDir, file);
  let content = readFileSync(filePath, 'utf8');

  if (apiUrl) {
    content = content.replace(/__API_URL__/g, apiUrl);
    console.log(`[inject-api-url] Injected API_URL into ${file}`);
  } else {
    // Leave placeholder as-is; the JS resolver will fall back to /api/tournament
    console.log(`[inject-api-url] No API_URL set — ${file} left unchanged (proxy mode).`);
  }

  writeFileSync(filePath, content, 'utf8');
}

console.log('[inject-api-url] Done.');
