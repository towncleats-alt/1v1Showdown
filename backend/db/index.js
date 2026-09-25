import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

// Enable SSL whenever DATABASE_URL is present and not pointing to localhost/127.
// Railway (and most cloud PG providers) require SSL — always use rejectUnauthorized:false
// for Railway's self-signed internal certs. Local dev (localhost) skips SSL entirely.
const dbUrl = process.env.DATABASE_URL ?? '';
const isLocalDb = /localhost|127\.0\.0\.1/.test(dbUrl);
const sslConfig = dbUrl && !isLocalDb ? { rejectUnauthorized: false } : undefined;

export const pool = new Pool({
  connectionString: dbUrl,
  // Pool size: env override → default 20 (enough for high-traffic tournament day).
  // Each Node process holds at most this many open PG connections.
  max: Number(process.env.DATABASE_POOL_MAX ?? 20),
  // Keep idle connections alive — reduces reconnect overhead under bursty load
  idleTimeoutMillis: 60_000,
  // Fail fast on connection attempt — ETag cache means most requests never touch DB
  connectionTimeoutMillis: 2_000,
  // Queue requests that exceed pool size rather than crashing — up to 50 queued
  allowExitOnIdle: false,
  ssl: sslConfig,
});

// ─── DB health tracking ───────────────────────────────────────────────────────
let _dbUp = null;          // null = unknown, true = up, false = down
let _lastCheck = 0;
let _probeInflight = false;
let _probePromise = null;  // shared promise while a probe is in-flight
const CHECK_INTERVAL = 10_000; // re-probe every 10s when DB is down

export function isDbAvailable() { return _dbUp === true; }
export function dbMode() { return _dbUp === true ? 'postgres' : 'memory'; }

async function probe() {
  if (_probeInflight) return _probePromise;
  _probeInflight = true;
  _probePromise = (async () => {
    try {
      await pool.query('SELECT 1');
      _dbUp = true;
    } catch {
      _dbUp = false;
    } finally {
      _lastCheck = Date.now();
      _probeInflight = false;
    }
  })();
  return _probePromise;
}

// Probe once at startup — await this before handling requests when _dbUp is null
const startupProbe = probe().catch(() => {});
export { startupProbe };

// Background re-probe every 10s so the server auto-reconnects when DB comes up
setInterval(() => probe().catch(() => {}), CHECK_INTERVAL);

/**
 * dbQuery — runs a pg query when DB is available.
 * Returns { rows } on success, throws on failure and marks DB down.
 */
export async function dbQuery(text, params) {
  // If status is still unknown (startup), wait for the initial probe to finish
  if (_dbUp === null) {
    await startupProbe;
  }
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
