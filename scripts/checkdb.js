import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query(
  "SELECT id, name, seed, approval_status, created_at FROM tournament_players ORDER BY created_at ASC LIMIT 10"
);
rows.forEach((r, i) => console.log(i + 1, r.seed, r.name, r.approval_status));
const { rows: c } = await pool.query(
  "SELECT COUNT(*) total, COUNT(*) FILTER (WHERE approval_status IN ('APPROVED','CHECKED_IN')) approved FROM tournament_players"
);
console.log('Total:', c[0].total, '| Eligible for bracket:', c[0].approved);
await pool.end();
