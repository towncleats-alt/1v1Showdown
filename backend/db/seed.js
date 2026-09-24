import 'dotenv/config';
import { pool } from './index.js';
import { hashPassword } from '../auth.js';

const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;

if (!email || !password) {
  console.warn('[seed] SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD not set — skipping admin seed.');
  await pool.end();
  process.exit(0);
}

try {
  const passwordHash = await hashPassword(password);
  await pool.query(`INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'SUPER_ADMIN')
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'SUPER_ADMIN', is_active = true`, [email.toLowerCase(), passwordHash]);
  console.log(`Seeded development admin: ${email}`);
} finally {
  await pool.end();
  process.exit(0);
}
