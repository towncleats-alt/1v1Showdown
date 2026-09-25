import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Pool size: env override → default 20 (enough for high-traffic tournament day).
  // Each Node process holds at most this many open PG connections.
  max: Number(process.env.DATABASE_POOL_MAX ?? 20),
  // Keep idle connections alive — reduces reconnect overhead under bursty load
  idleTimeoutMillis: 60_000,
  // Fail fast on connection attempt — ETag cache means most requests never touch DB
  connectionTimeoutMillis: 2_000,
  // Queue requests that exceed pool size rather than crashing — up to 50 queued
  allowExitOnIdle: false,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

// ─── DB health tracking ───────────────────────────────────────────────────────
let _dbUp = null;          // null = unknown, true = up, false = down
let _lastCheck = 0;
let _probeInflight = false;
const CHECK_INTERVAL = 10_000; // re-probe every 10s when DB is down

export function isDbAvailable() { return _dbUp === true; }
export function dbMode() { return _dbUp === true ? 'postgres' : 'memory'; }

async function probe() {
  if (_probeInflight) return;
  _probeInflight = true;
  try {
    await pool.query('SELECT 1');
    _dbUp = true;
  } catch {
    _dbUp = false;
  } finally {
    _lastCheck = Date.now();
    _probeInflight = false;
  }
}

// Probe once at startup (non-blocking)
probe().catch(() => {});

// Background re-probe every 10s so the server auto-reconnects when DB comes up
setInterval(() => probe().catch(() => {}), CHECK_INTERVAL);

/**
 * dbQuery — runs a pg query when DB is available.
 * Returns { rows } on success, throws on failure and marks DB down.
 */
export async function dbQuery(text, params) {
  // If we know DB is down, trigger a background re-probe and throw
  if (_dbUp === false) {
    if (Date.now() - _lastCheck >= CHECK_INTERVAL) probe().catch(() => {});
    throw new Error('DB unavailable');
  }
  try {
    const result = await pool.query(text, params);
    _dbUp = true;
    return result;
  } catch (err) {
    _dbUp = false;
    _lastCheck = Date.now();
    throw err;
  }
}

export async function checkDatabase() {
  const { rows } = await dbQuery('SELECT now() AS now');
  return rows[0];
}
