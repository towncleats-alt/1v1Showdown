/**
 * Security hardening middleware.
 * Import and apply in server.js with:  app.use(...security.middleware());
 */

import { rateLimit } from 'express-rate-limit';

// ─── Sanitize a string — strip HTML/script tags and control chars ─────────────
export function sanitizeString(value, maxLen = 500) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/<[^>]*>/g, '')               // strip HTML tags
    .replace(/[^\x20-\x7E\u0600-\u06FF\u0080-\u00FF]/g, '') // keep printable + Urdu/Arabic + Latin extended
    .trim()
    .slice(0, maxLen);
}

// ─── Recursively sanitize all string values in a request body ─────────────────
export function sanitizeBody(obj, depth = 0) {
  if (depth > 5 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.slice(0, 50).map(item => sanitizeBody(item, depth + 1));
  const clean = {};
  for (const [key, value] of Object.entries(obj)) {
    const safeKey = sanitizeString(key, 64);
    if (typeof value === 'string') clean[safeKey] = sanitizeString(value);
    else if (typeof value === 'object' && value !== null) clean[safeKey] = sanitizeBody(value, depth + 1);
    else if (typeof value === 'number' || typeof value === 'boolean') clean[safeKey] = value;
    // drop anything else (functions, symbols, etc.)
  }
  return clean;
}

// ─── Middleware: sanitize req.body in-place ───────────────────────────────────
export function sanitizeBodyMiddleware(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeBody(req.body);
  }
  next();
}

// ─── Rate limiters ────────────────────────────────────────────────────────────

// General API: 200 req/min per IP — covers all routes
export const generalLimiter = rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

// Auth endpoints: 10 attempts/15 min per IP — brute-force protection
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
  skipSuccessfulRequests: true, // only count failed attempts
});

// Registration: 5/hour per IP — prevents spam registrations
export const registerLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts from this device.' },
});

// ─── Security response headers (supplement helmet) ───────────────────────────
export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
}

// ─── Prevent parameter pollution ─────────────────────────────────────────────
export function preventParamPollution(req, _res, next) {
  // If a query param appears multiple times, keep only the last value
  for (const key of Object.keys(req.query)) {
    if (Array.isArray(req.query[key])) {
      req.query[key] = req.query[key].at(-1);
    }
  }
  next();
}

// ─── Bundle: returns array of middleware to apply globally ────────────────────
export function middleware() {
  return [
    securityHeaders,
    preventParamPollution,
    generalLimiter,
    sanitizeBodyMiddleware,
  ];
}
