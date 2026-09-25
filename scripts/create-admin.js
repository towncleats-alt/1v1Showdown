/**
 * scripts/create-admin.js
 * Creates or resets the admin user directly.
 * Usage: node scripts/create-admin.js
 * Uses SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD env vars,
 * or falls back to hardcoded defaults below.
 */
import { pool } from '../backend/db/index.js';
import { hashPassword } from '../backend/auth.js';

const email    = process.env.SEED_ADMIN_EMAIL    || 'towncleats@gmail.com';
const password = process.env.SEED_ADMIN_PASSWORD || '03045534884.Mm';

try {
  const hash = await hashPassword(password);
  await pool.query(
    `INSERT INTO users (email, password_hash, role, is_active)
     VALUES ($1, $2, 'SUPER_ADMIN', true)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           role          = 'SUPER_ADMIN',
           is_active     = true`,
    [email.toLowerCase(), hash]
  );
  console.log(`✅ Admin created/updated: ${email}`);
} catch (e) {
  console.error('❌ Failed:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
  process.exit(process.exitCode ?? 0);
}
