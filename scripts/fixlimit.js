import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(`UPDATE tournament_settings SET settings = settings || '{"participantLimit": 0}'::jsonb WHERE id = 1`);
const { rows } = await pool.query(`SELECT settings->>'participantLimit' AS lim FROM tournament_settings WHERE id=1`);
console.log('participantLimit now:', rows[0].lim);
await pool.end();
