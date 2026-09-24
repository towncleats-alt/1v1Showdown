import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pool } from './db/index.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const failedAttempts = new Map();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('Password must be at least 12 characters.');
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1 });
  return `scrypt$${salt}$${derivedKey.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  const [algorithm, salt, key] = String(storedHash ?? '').split('$');
  if (algorithm !== 'scrypt' || !salt || !key) return false;
  const derivedKey = await scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1 });
  const expected = Buffer.from(key, 'hex');
  return expected.length === derivedKey.length && crypto.timingSafeEqual(expected, derivedKey);
}

function attemptKey(email, ip) {
  return `${email.toLowerCase()}:${ip}`;
}

export function isLoginThrottled(email, ip) {
  const attempt = failedAttempts.get(attemptKey(email, ip));
  return attempt && attempt.until > Date.now();
}

function registerFailedAttempt(email, ip) {
  const key = attemptKey(email, ip);
  const current = failedAttempts.get(key) ?? { count: 0, until: 0 };
  current.count += 1;
  if (current.count >= 5) current.until = Date.now() + 15 * 60 * 1000;
  failedAttempts.set(key, current);
}

function clearFailedAttempts(email, ip) {
  failedAttempts.delete(attemptKey(email, ip));
}

export async function getUserPermissions(userId) {
  if (!userId) return [];
  const { rows } = await pool.query(`SELECT DISTINCT p.code
    FROM permissions p
    JOIN role_permissions rp ON rp.permission_id = p.id
    JOIN users u ON u.role = rp.role
    WHERE u.id = $1`, [userId]);
  return rows.map((row) => row.code);
}

export async function authenticate(email, password, ip) {
  if (isLoginThrottled(email, ip)) return { throttled: true };
  const { rows } = await pool.query('SELECT id, email, password_hash, role, is_active FROM users WHERE lower(email) = lower($1) LIMIT 1', [email]);
  const user = rows[0];
  const valid = user?.is_active && user.password_hash && await verifyPassword(password, user.password_hash);
  if (!valid) {
    registerFailedAttempt(email, ip);
    return { user: null };
  }
  clearFailedAttempts(email, ip);
  return { user: { ...user, permissions: await getUserPermissions(user.id) } };
}

export async function createSession(userId, ip, userAgent) {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query('INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5)', [userId, hashToken(rawToken), expiresAt, ip, userAgent ?? null]);
  return { rawToken, expiresAt };
}

export async function revokeSession(rawToken) {
  await pool.query('UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [hashToken(rawToken)]);
}

export async function getSessionUser(rawToken) {
  if (!rawToken) return null;
  const { rows } = await pool.query(`SELECT u.id, u.email, u.role, u.is_active, s.id AS session_id
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active = true`, [hashToken(rawToken)]);
  const user = rows[0];
  if (!user) return null;
  const permissions = await getUserPermissions(user.id);
  return { ...user, permissions };
}

export function sessionCookieOptions(expiresAt) {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', expires: expiresAt, path: '/' };
}

export function requireAuth(request, response, next) {
  getSessionUser(request.cookies?.faisalabad_session).then((user) => {
    if (!user) return response.status(401).json({ error: 'Authentication required.' });
    request.user = user;
    next();
  }).catch(next);
}

export function requireRole(...roles) {
  return (request, response, next) => {
    if (!request.user || !roles.includes(request.user.role)) return response.status(403).json({ error: 'Insufficient permission.' });
    next();
  };
}

export function requirePermission(permission) {
  return (request, response, next) => {
    const user = request.user ?? {};
    const permissions = Array.isArray(user.permissions) ? user.permissions : [];
    const isSuperAdmin = user.role === 'SUPER_ADMIN';
    if (!user || (!isSuperAdmin && !permissions.includes(permission))) {
      return response.status(403).json({ error: 'Permission denied.' });
    }
    next();
  };
}

export { registerFailedAttempt };
