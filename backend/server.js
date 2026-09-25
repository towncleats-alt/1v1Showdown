import 'dotenv/config';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { checkDatabase, pool, dbQuery, isDbAvailable, dbMode } from './db/index.js';
import { authenticate, createSession, getSessionUser, hashPassword, verifyPassword, requireAuth, requireRole, requirePermission, revokeSession } from './auth.js';
import { validatePlayerRegistration } from './playerRegistration.js';
import { validatePaymentSubmission, validatePlayerReviewAction } from './playerReview.js';
import { canPlayerCheckIn, validateTournamentEvent, validateTournamentMatchState, validateTournamentScore } from './tournamentState.js';
import * as store from './db/store.js';
import { middleware as securityMiddleware, authLimiter, registerLimiter } from './security.js';
import { notifyPlayerRegistered } from './notifications.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);          // needed behind nginx/load-balancer for correct IPs
const port = Number(process.env.API_PORT ?? 4000);
const expectedKey = process.env.TOURNAMENT_API_KEY ?? null;
const allowedOrigins = (process.env.CORS_ORIGINS ?? `http://127.0.0.1:${port},http://localhost:${port}`).split(',').map((origin) => origin.trim());
const isDevelopmentOrigin = process.env.APP_ENV === 'development'
  ? (origin) => /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
  : () => false;

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ credentials: true, origin: (origin, callback) => {
  if (!origin || allowedOrigins.includes(origin) || (isDevelopmentOrigin && isDevelopmentOrigin(origin))) return callback(null, true);
  return callback(null, false);
} }));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));
app.use(...securityMiddleware());

// ── Gzip compression for all text responses ───────────────────────────────────
app.use((req, res, next) => {
  const ae = req.headers['accept-encoding'] || '';
  if (!ae.includes('gzip')) return next();
  const _json = res.json.bind(res);
  res.json = (body) => {
    const buf = Buffer.from(JSON.stringify(body), 'utf8');
    zlib.gzip(buf, (err, compressed) => {
      if (err || compressed.length >= buf.length) return _json(body);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Length', compressed.length);
      res.end(compressed);
    });
  };
  next();
});

function parseCookies(request, _response, next) {
  request.cookies = Object.fromEntries((request.headers.cookie ?? '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
  next();
}
app.use(parseCookies);

function setSessionCookie(response, token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  response.setHeader('Set-Cookie', `faisalabad_session=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

app.get('/health', async (_request, response) => {
  try {
    const database = await checkDatabase();
    response.json({ status: 'ok', service: 'faisalabad-1v1-api', database: 'healthy', mode: 'postgres', time: database.now });
  } catch {
    response.json({ status: 'ok', service: 'faisalabad-1v1-api', database: 'unavailable', mode: 'memory', time: new Date().toISOString() });
  }
});

app.post('/api/v1/auth/login', authLimiter, async (request, response, next) => {
  try {
    const { email, password } = request.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') return response.status(400).json({ error: 'Email and password are required.' });
    const result = await authenticate(email, password, request.ip);
    if (result.throttled) return response.status(429).json({ error: 'Too many login attempts. Try again later.' });
    if (!result.user) return response.status(401).json({ error: 'Invalid email or password.' });
    const session = await createSession(result.user.id, request.ip, request.get('user-agent'));
    await pool.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)', [result.user.id, 'LOGIN', 'USER', result.user.id, JSON.stringify({ ip: request.ip })]);
    setSessionCookie(response, session.rawToken, session.expiresAt);
    const profile = result.user.role === 'PLAYER' ? await pool.query('SELECT profile_completed FROM players WHERE user_id = $1 LIMIT 1', [result.user.id]) : null;
    response.json({ user: { id: result.user.id, email: result.user.email, role: result.user.role, profileCompleted: profile ? Boolean(profile.rows[0]?.profile_completed) : true } });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/auth/logout', async (request, response, next) => {
  try {
    const token = request.cookies?.faisalabad_session;
    const user = await getSessionUser(token);
    if (token) await revokeSession(token);
    if (user) await pool.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id) VALUES ($1, $2, $3, $4)', [user.id, 'LOGOUT', 'USER', user.id]);
    setSessionCookie(response, '', new Date());
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/auth/me', requireAuth, (request, response, next) => {
  const load = request.user.role === 'PLAYER' ? pool.query('SELECT profile_completed FROM players WHERE user_id = $1 LIMIT 1', [request.user.id]) : Promise.resolve({ rows: [] });
  load.then((profile) => response.json({ user: { id: request.user.id, email: request.user.email, role: request.user.role, profileCompleted: request.user.role === 'PLAYER' ? Boolean(profile.rows[0]?.profile_completed) : true } })).catch(next);
});

app.get('/api/v1/tournament/settings', async (_request, response, next) => {
  try {
    const { rows } = await pool.query('SELECT settings FROM tournament_settings WHERE id = 1');
    response.json({ settings: rows[0]?.settings ?? {} });
  } catch (error) { next(error); }
});

app.get('/api/v1/admin/users', requireAuth, requireRole('SUPER_ADMIN'), async (_request, response, next) => {
  try {
    const { rows } = await pool.query('SELECT id, email, role, is_active, created_at, updated_at FROM users WHERE role IN (\'ADMIN\', \'SUPER_ADMIN\') ORDER BY created_at');
    response.json({ users: rows });
  } catch (error) { next(error); }
});

app.post('/api/v1/admin/users', requireAuth, requireRole('SUPER_ADMIN'), async (request, response, next) => {
  try {
    const email = String(request.body?.email ?? '').trim().toLowerCase();
    const password = String(request.body?.password ?? '');
    if (!email.includes('@') || password.length < 12) return response.status(400).json({ error: 'A valid email and a password of at least 12 characters are required.' });
    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(`INSERT INTO users (email, password_hash, role, is_active)
      VALUES ($1, $2, 'ADMIN', true)
      RETURNING id, email, role, is_active, created_at`, [email, passwordHash]);
    await pool.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_state) VALUES ($1, $2, $3, $4, $5)', [request.user.id, 'ADMIN_CREATED', 'USER', rows[0].id, JSON.stringify({ email, role: 'ADMIN' })]);
    response.status(201).json({ user: rows[0] });
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ error: 'A user with this email already exists.' });
    next(error);
  }
});

app.patch('/api/v1/admin/users/:userId', requireAuth, requireRole('SUPER_ADMIN'), async (request, response, next) => {
  try {
    if (request.params.userId === request.user.id && request.body?.isActive === false) return response.status(400).json({ error: 'You cannot deactivate your own account.' });
    const isActive = request.body?.isActive;
    const role = request.body?.role;
    if (typeof isActive !== 'boolean' && !['ADMIN', 'SUPER_ADMIN'].includes(role)) return response.status(400).json({ error: 'Provide a valid active state or admin role.' });
    const { rows } = await pool.query(`UPDATE users
      SET is_active = COALESCE($2, is_active), role = COALESCE($3, role), updated_at = now()
      WHERE id = $1 AND role IN ('ADMIN', 'SUPER_ADMIN')
      RETURNING id, email, role, is_active, created_at, updated_at`, [request.params.userId, typeof isActive === 'boolean' ? isActive : null, role ?? null]);
    if (!rows.length) return response.status(404).json({ error: 'Admin user not found.' });
    response.json({ user: rows[0] });
  } catch (error) { next(error); }
});

app.put('/api/v1/admin/tournament/settings', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (request, response, next) => {
  try {
    if (!request.body || typeof request.body.settings !== 'object' || Array.isArray(request.body.settings)) return response.status(400).json({ error: 'Settings must be an object.' });
    const { rows } = await pool.query(`UPDATE tournament_settings SET settings = $1, updated_by = $2, updated_at = now() WHERE id = 1 RETURNING settings, updated_at`, [JSON.stringify(request.body.settings), request.user.id]);
    response.json({ settings: rows[0].settings, updatedAt: rows[0].updated_at });
  } catch (error) { next(error); }
});

// Public self-registration disabled — Admin creates players via /api/tournament/players
app.post('/api/v1/player/register', (_request, response) => {
  return response.status(403).json({ error: 'Public self-registration is disabled. Contact the tournament admin to get your login credentials.' });
});
app.post('/api/v1/player/register_disabled', registerLimiter, async (request, response, next) => {
  try {
    let payload;
    try {
      payload = validatePlayerRegistration(request.body ?? {});
    } catch (error) {
      return response.status(400).json({ error: error.message });
    }
    const email = payload.email.toLowerCase();
    const password = String(request.body?.password ?? '').trim();
    if (!password || password.length < 12) {
      return response.status(400).json({ error: 'Password must be at least 12 characters long.' });
    }

    const passwordHash = await hashPassword(password);
    const userInsert = await pool.query(
      `INSERT INTO users (email, password_hash, role, is_active)
       VALUES ($1, $2, 'PLAYER', true)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id, email, role`,
      [email, passwordHash]
    );

    const user = userInsert.rows[0];
    const token = crypto.randomUUID();
    const slug = `player-${user.id.slice(0, 8)}`;
    const insertPlayer = await pool.query(
      `INSERT INTO players (
        user_id, full_name, display_name, slug, gmail_address, cell_phone, whatsapp_contact,
        email_verified, phone_verified, whatsapp_verified, registration_status, payment_status,
        approval_status, verification_token, token_expires_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, false, false, 'PENDING', 'NOT_SUBMITTED', 'PENDING', $8, now() + interval '24 hours', now(), now())
      ON CONFLICT (user_id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        display_name = EXCLUDED.display_name,
        gmail_address = EXCLUDED.gmail_address,
        cell_phone = EXCLUDED.cell_phone,
        whatsapp_contact = EXCLUDED.whatsapp_contact,
        verification_token = EXCLUDED.verification_token,
        token_expires_at = EXCLUDED.token_expires_at,
        registration_status = 'PENDING',
        updated_at = now()
      RETURNING *`,
      [user.id, payload.name, payload.name, slug, email, payload.phone, payload.whatsapp, token]
    );

    await pool.query(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_state, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, 'PLAYER_REGISTERED', 'PLAYER', insertPlayer.rows[0].id, JSON.stringify({ registrationStatus: 'PENDING' }), JSON.stringify({ email, phone: payload.phone, whatsapp: payload.whatsapp })]
    );

    response.status(201).json({
      user: { id: user.id, email: user.email, role: user.role },
      player: insertPlayer.rows[0],
      verification: { token },
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/player/profile', requireAuth, requireRole('PLAYER'), async (request, response, next) => {
  try {
    const { rows } = await pool.query(`SELECT full_name, display_name, whatsapp_contact, cell_phone, photo_url, address, best_skills, game_videos,
      emergency_contact_name, emergency_contact_relation, gmail_address, profile_completed, profile_completed_at,
      email_verified, phone_verified, whatsapp_verified, payment_status, payment_reference, payment_method,
      payment_amount, payment_submitted_at, payment_verified_at, approval_status, registration_status, verification_token, token_expires_at
      FROM players WHERE user_id = $1 LIMIT 1`, [request.user.id]);
    const profile = rows[0] ?? null;
    const matches = profile ? await pool.query(`SELECT id, round, player_a, player_b, score_a, score_b, state, video_url, video_title
      FROM tournament_matches WHERE player_a = $1 OR player_b = $1 ORDER BY created_at DESC`, [profile.full_name]) : { rows: [] };
    response.json({ profile, matches: matches.rows });
  } catch (error) {
    next(error);
  }
});

app.put('/api/v1/player/profile', requireAuth, requireRole('PLAYER'), async (request, response, next) => {
  try {
    const { fullName, displayName, whatsappContact, cellPhone, photoUrl, address, emergencyContactName, emergencyContactRelation, gmailAddress, bestSkills, gameVideos } = request.body ?? {};
    const fields = [fullName, displayName, whatsappContact, cellPhone, address, emergencyContactName, emergencyContactRelation, gmailAddress];
    if (fields.some((value) => typeof value !== 'string' || value.trim().length < 2) || (photoUrl !== undefined && typeof photoUrl !== 'string')) return response.status(400).json({ error: 'Complete every required profile field before continuing.' });
    if (fields.some((value) => value.length > 200) || String(photoUrl ?? '').length > 2000 || String(bestSkills ?? '').length > 1000) return response.status(400).json({ error: 'Profile information is too long.' });
    const normalizedVideos = Array.isArray(gameVideos) ? gameVideos.map((video) => String(video).trim()).filter(Boolean).slice(0, 10) : [];
    if (normalizedVideos.some((video) => video.length > 2000)) return response.status(400).json({ error: 'A game video URL is too long.' });
    const slug = `player-${request.user.id}`;
    const { rows } = await pool.query(`INSERT INTO players (user_id, full_name, display_name, slug, whatsapp_contact, cell_phone, photo_url, address, emergency_contact_name, emergency_contact_relation, gmail_address, best_skills, game_videos, profile_completed, profile_completed_at)
      VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8, $9, $10, $11, $12, $13, true, now())
      ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name, display_name = EXCLUDED.display_name, whatsapp_contact = EXCLUDED.whatsapp_contact, cell_phone = EXCLUDED.cell_phone, photo_url = EXCLUDED.photo_url, address = EXCLUDED.address, emergency_contact_name = EXCLUDED.emergency_contact_name, emergency_contact_relation = EXCLUDED.emergency_contact_relation, gmail_address = EXCLUDED.gmail_address, best_skills = EXCLUDED.best_skills, game_videos = EXCLUDED.game_videos, profile_completed = true, profile_completed_at = now(), updated_at = now()
      RETURNING full_name, display_name, whatsapp_contact, cell_phone, photo_url, address, emergency_contact_name, emergency_contact_relation, gmail_address, best_skills, game_videos, profile_completed, profile_completed_at`, [request.user.id, fullName.trim(), displayName.trim(), slug, whatsappContact.trim(), cellPhone.trim(), String(photoUrl ?? '').trim(), address.trim(), emergencyContactName.trim(), emergencyContactRelation.trim(), gmailAddress.trim(), String(bestSkills ?? '').trim(), JSON.stringify(normalizedVideos)]);
    await pool.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_state) SELECT $1, $2, $3, id, $4 FROM players WHERE user_id = $1', [request.user.id, 'PLAYER_PROFILE_COMPLETED', 'PLAYER', JSON.stringify({ profileCompleted: true })]);
    response.json({ profile: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/player/payment', requireAuth, requireRole('PLAYER'), async (request, response, next) => {
  try {
    const payload = validatePaymentSubmission(request.body ?? {});
    const { rows } = await pool.query(`UPDATE players
      SET payment_status = 'PENDING',
          payment_reference = $2,
          payment_method = $3,
          payment_amount = $4,
          payment_submitted_at = now(),
          registration_status = 'REGISTERED',
          updated_at = now()
      WHERE user_id = $1
      RETURNING id, user_id, full_name, payment_status, payment_reference, payment_method, payment_amount, payment_submitted_at, approval_status, registration_status`,
      [request.user.id, payload.paymentReference, payload.paymentMethod, payload.paymentAmount]);
    if (!rows.length) return response.status(404).json({ error: 'Player profile not found.' });
    await pool.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_state, metadata) VALUES ($1, $2, $3, $4, $5, $6)', [request.user.id, 'PAYMENT_SUBMITTED', 'PLAYER', rows[0].id, JSON.stringify({ paymentStatus: 'PENDING' }), JSON.stringify({ paymentMethod: payload.paymentMethod, paymentReference: payload.paymentReference, amount: payload.paymentAmount })]);
    response.json({ player: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/admin/players', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'TOURNAMENT_MANAGER'), async (_request, response, next) => {
  try {
    const { rows } = await pool.query(`SELECT p.*, u.email
      FROM players p
      LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC`);
    response.json({ players: rows });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/v1/admin/players/:playerId/review', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'TOURNAMENT_MANAGER'), async (request, response, next) => {
  try {
    const decision = validatePlayerReviewAction(request.body ?? {});
    const { rows } = await pool.query(`UPDATE players
      SET payment_status = CASE
        WHEN $2 IN ('APPROVE', 'VERIFY_PAYMENT') THEN 'VERIFIED'
        WHEN $2 = 'REJECT' THEN 'REJECTED'
        WHEN $2 = 'SUSPEND' THEN 'REJECTED'
        WHEN $2 = 'WITHDRAW' THEN 'REJECTED'
        WHEN $2 = 'CHECK_IN' THEN 'VERIFIED'
        ELSE payment_status END,
          approval_status = CASE
            WHEN $2 = 'APPROVE' THEN 'APPROVED'
            WHEN $2 = 'REJECT' THEN 'REJECTED'
            WHEN $2 = 'SUSPEND' THEN 'SUSPENDED'
            WHEN $2 = 'WITHDRAW' THEN 'WITHDRAWN'
            WHEN $2 = 'CHECK_IN' THEN 'CHECKED_IN'
            ELSE approval_status END,
          registration_status = CASE
            WHEN $2 = 'CHECK_IN' THEN 'CHECKED_IN'
            WHEN $2 = 'APPROVE' THEN 'APPROVED'
            WHEN $2 = 'REJECT' THEN 'REJECTED'
            ELSE registration_status END,
          notes = COALESCE(NULLIF($3, ''), notes),
          approved_by = $4,
          approved_at = now(),
          payment_verified_at = CASE WHEN $2 IN ('APPROVE', 'VERIFY_PAYMENT', 'CHECK_IN') THEN now() ELSE payment_verified_at END,
          payment_verified_by = CASE WHEN $2 IN ('APPROVE', 'VERIFY_PAYMENT', 'CHECK_IN') THEN $4 ELSE payment_verified_by END,
          updated_at = now()
      WHERE id = $1
      RETURNING *`, [request.params.playerId, decision.decision, decision.notes, request.user.id]);
    if (!rows.length) return response.status(404).json({ error: 'Player not found.' });
    await pool.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_state, metadata) VALUES ($1, $2, $3, $4, $5, $6)', [request.user.id, `PLAYER_${decision.normalizedDecision}`, 'PLAYER', rows[0].id, JSON.stringify({ approvalStatus: decision.normalizedDecision, paymentStatus: rows[0].payment_status }), JSON.stringify({ decision: decision.decision, notes: decision.notes })]);
    response.json({ player: rows[0], decision: decision.normalizedDecision });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/admin/players/checkin', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'TOURNAMENT_MANAGER'), async (request, response, next) => {
  try {
    const { playerId } = request.body ?? {};
    if (!playerId) return response.status(400).json({ error: 'Player ID is required.' });

    const { rows } = await pool.query('SELECT * FROM players WHERE id = $1 LIMIT 1', [playerId]);
    const player = rows[0];
    if (!player) return response.status(404).json({ error: 'Player not found.' });

    const eligibility = canPlayerCheckIn(player);
    if (!eligibility.allowed) {
      return response.status(409).json({ error: 'Player is not eligible to check in.', details: eligibility.reason });
    }

    const updated = await pool.query(`UPDATE players
      SET approval_status = 'CHECKED_IN',
          registration_status = 'CHECKED_IN',
          payment_status = CASE WHEN payment_status = 'NOT_SUBMITTED' THEN 'VERIFIED' ELSE payment_status END,
          approved_by = $2,
          approved_at = now(),
          updated_at = now()
      WHERE id = $1
      RETURNING *`, [playerId, request.user.id]);

    await pool.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_state, metadata) VALUES ($1, $2, $3, $4, $5, $6)', [request.user.id, 'PLAYER_CHECKED_IN', 'PLAYER', updated.rows[0].id, JSON.stringify({ approvalStatus: 'CHECKED_IN', registrationStatus: 'CHECKED_IN' }), JSON.stringify({ playerId })]);

    response.json({ player: updated.rows[0], eligible: true, reason: eligibility.reason });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/admin/tournament/state/validate', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'TOURNAMENT_MANAGER'), async (request, response, next) => {
  try {
    const { currentState, nextState } = request.body ?? {};
    const valid = validateTournamentMatchState(currentState, nextState);
    response.json({ valid, currentState, nextState });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/admin/tournament/matches/:matchId/transition', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'TOURNAMENT_MANAGER'), async (request, response, next) => {
  try {
    const { currentState, nextState, timerSeconds } = request.body ?? {};
    if (!validateTournamentMatchState(currentState, nextState)) {
      return response.status(409).json({ error: 'Invalid match state transition for this tournament lifecycle.' });
    }

    const { rows } = await pool.query(`UPDATE tournament_matches
      SET state = $2,
          updated_at = now()
      WHERE id = $1
      RETURNING *`, [request.params.matchId, nextState]);
    if (!rows.length) return response.status(404).json({ error: 'Match not found.' });

    await pool.query(`UPDATE tournament_timer
      SET timer_seconds = COALESCE($2, timer_seconds),
          match_state = $3,
          live_match_id = CASE WHEN $3 = 'LIVE' THEN $1 ELSE live_match_id END,
          updated_at = now()
      WHERE id = 1`, [request.params.matchId, timerSeconds ?? 0, nextState]);

    await pool.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_state, metadata) VALUES ($1, $2, $3, $4, $5, $6)', [request.user.id, 'MATCH_TRANSITION', 'MATCH', rows[0].id, JSON.stringify({ state: nextState }), JSON.stringify({ previousState: currentState, nextState, timerSeconds: timerSeconds ?? 0 })]);

    response.json({ match: rows[0], valid: true });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/v1/admin/tournament/matches/:matchId/score', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'TOURNAMENT_MANAGER'), async (request, response, next) => {
  try {
    const { scoreA, scoreB } = request.body ?? {};
    if (!validateTournamentScore(scoreA, scoreB)) {
      return response.status(400).json({ error: 'Score values must be non-negative numbers.' });
    }

    const { rows } = await pool.query(`UPDATE tournament_matches
      SET score_a = $2,
          score_b = $3,
          updated_at = now()
      WHERE id = $1
      RETURNING *`, [request.params.matchId, Number(scoreA), Number(scoreB)]);
    if (!rows.length) return response.status(404).json({ error: 'Match not found.' });

    await pool.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_state, metadata) VALUES ($1, $2, $3, $4, $5, $6)', [request.user.id, 'MATCH_SCORE_UPDATED', 'MATCH', rows[0].id, JSON.stringify({ scoreA: Number(scoreA), scoreB: Number(scoreB) }), JSON.stringify({ scoreA: Number(scoreA), scoreB: Number(scoreB) })]);

    response.json({ match: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/admin/tournament/matches/:matchId/events', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'TOURNAMENT_MANAGER'), async (request, response, next) => {
  try {
    const event = request.body ?? {};
    if (!validateTournamentEvent(event)) {
      return response.status(400).json({ error: 'Event payload is invalid for the tournament lifecycle.' });
    }

    const { rows } = await pool.query(`INSERT INTO tournament_events (match_id, minute, event_type, player_name, detail, side)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`, [request.params.matchId, String(event.minute), String(event.eventType ?? event.type).toUpperCase(), String(event.playerName ?? event.player ?? ''), String(event.detail ?? ''), String(event.side ?? 'A').toUpperCase()]);

    await pool.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_state, metadata) VALUES ($1, $2, $3, $4, $5, $6)', [request.user.id, 'MATCH_EVENT_CREATED', 'MATCH_EVENT', rows[0].id, JSON.stringify({ eventType: rows[0].event_type }), JSON.stringify({ matchId: request.params.matchId, minute: rows[0].minute, detail: rows[0].detail })]);

    response.status(201).json({ event: rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/admin/access-check', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'TOURNAMENT_MANAGER'), (request, response) => {
  response.json({ allowed: true, role: request.user.role });
});

app.use('/api/v1', (request, response, next) => {
  if (
    request.path.startsWith('/auth/') ||
    request.path.startsWith('/player/') ||
    request.path.startsWith('/admin/')
  ) return next();
  if (!expectedKey) return response.status(503).json({ error: 'API service is not configured.' });
  if (request.get('x-api-key') !== expectedKey) return response.status(401).json({ error: 'Invalid API key.' });
  next();
});

app.get('/api/v1/tournaments/current', async (_request, response) => {
  try {
    const { rows } = await pool.query("SELECT id, name, slug, timezone, status FROM tournaments WHERE status IN ('PUBLISHED', 'LIVE') ORDER BY created_at DESC LIMIT 1");
    response.json({ data: rows[0] ?? null });
  } catch (error) {
    console.error('Tournament lookup failed:', error);
    response.status(500).json({ error: 'Unable to load tournament data.' });
  }
});

app.patch('/api/v1/admin/tournament/matches/:matchId/video', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN', 'MEDIA_MANAGER'), async (request, response, next) => {
  try {
    const videoUrl = String(request.body?.videoUrl ?? '').trim();
    const videoTitle = String(request.body?.videoTitle ?? '').trim();
    if (videoUrl.length > 2000 || videoTitle.length > 200) return response.status(400).json({ error: 'Video details are too long.' });
    const { rows } = await pool.query(`UPDATE tournament_matches
      SET video_url = NULLIF($2, ''), video_title = NULLIF($3, ''), updated_at = now()
      WHERE id = $1 RETURNING id, video_url, video_title`, [request.params.matchId, videoUrl, videoTitle]);
    if (!rows.length) return response.status(404).json({ error: 'Match not found.' });
    await pool.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_state) VALUES ($1, $2, $3, $4, $5)', [request.user.id, 'MATCH_VIDEO_UPDATED', 'MATCH', rows[0].id, JSON.stringify({ videoUrl: rows[0].video_url, videoTitle: rows[0].video_title })]);
    response.json({ match: rows[0] });
  } catch (error) { next(error); }
});

// ── Tournament ops — DB-first, in-memory fallback on every route ─────────────
// Helper: shape a player row → UI-expected object
function shapePlayer(p) {
  return {
    id: p.id, name: p.name, seed: p.seed ?? '—', status: p.status ?? 'Active',
    goals: p.goals ?? 0, shots: p.shots ?? 0, matches: p.matches ?? 0,
    gmail: p.gmail_address ?? '', cellPhone: p.cell_phone ?? '',
    whatsapp: p.whatsapp_contact ?? '', photoUrl: p.photo_url ?? '',
    preferredKeeper: p.preferred_keeper ?? '', dominantFoot: p.dominant_foot ?? 'Right',
    city: p.city ?? 'Faisalabad', bio: p.bio ?? '', bestSkills: p.best_skills ?? '',
    gameVideos: typeof p.game_videos === 'string' ? JSON.parse(p.game_videos) : (p.game_videos ?? []),
    paymentStatus: p.payment_status ?? 'NOT_SUBMITTED', paymentRef: p.payment_ref ?? '',
    paymentMethod: p.payment_method ?? 'EasyPaisa/Cash',
    approvalStatus: p.approval_status ?? 'PENDING',
    checkedIn: Boolean(p.checked_in), notes: p.notes ?? '',
  };
}
function shapeMatch(m) {
  return {
    id: m.id, round: m.round, playerA: m.player_a, playerB: m.player_b,
    scoreA: m.score_a ?? 0, scoreB: m.score_b ?? 0,
    time: m.match_time ?? '18:00', state: m.state ?? 'UPCOMING',
    videoUrl: m.video_url ?? '', videoTitle: m.video_title ?? '',
  };
}
function shapeEvent(e) {
  return { id: e.id, matchId: e.match_id, minute: e.minute, type: e.event_type, player: e.player_name, detail: e.detail, side: e.side };
}

const DEFAULT_SETTINGS = {
  tournamentName: '1 ON 1 SHOWDOWN FAISALABAD', headerTitle: '1 ON 1 SHOWDOWN',
  headerSubtitle: 'Sunday, Oct 11, 2026 · Padel Pavilion, Faisalabad',
  venue: 'Padel Pavilion, Faisalabad', timezone: 'Asia/Karachi',
  participantLimit: 32, matchDuration: 15, tryDuration: 45,
  triesPerPlayer: 5, suddenDuration: 15, timeoutAllowance: 90,
  footerText: '1 ON 1 SHOWDOWN FAISALABAD — Official Tournament Platform',
};

// ── /state: ETag cache + in-flight dedup ─────────────────────────────────────
// Under high visitor load every browser polls /state every 7s.
// Strategy: build the payload once, cache it in memory for up to 2s with an ETag.
// If 200 concurrent requests arrive at once, only ONE DB query runs — the others
// wait on the same promise (in-flight dedup), then get the cached result.
// Client receives 304 Not Modified when nothing changed → zero JSON transfer.

let _stateCache = null;   // { etag, json, ts }
let _stateInflight = null; // single Promise shared across concurrent callers

async function buildStatePayload() {
  if (isDbAvailable()) {
    const [pR, mR, tR, sR, aR] = await Promise.all([
      dbQuery('SELECT * FROM tournament_players ORDER BY created_at ASC'),
      dbQuery('SELECT * FROM tournament_matches ORDER BY created_at ASC'),
      dbQuery('SELECT * FROM tournament_timer WHERE id = 1 LIMIT 1'),
      dbQuery('SELECT settings FROM tournament_settings WHERE id = 1 LIMIT 1'),
      dbQuery("SELECT id, email, role, is_active, created_at FROM users WHERE role IN ('ADMIN','SUPER_ADMIN') ORDER BY created_at ASC"),
    ]);
    const matchIds = mR.rows.map(m => m.id);
    let evRows = [];
    if (matchIds.length) {
      const eR = await dbQuery('SELECT * FROM tournament_events WHERE match_id = ANY($1) ORDER BY created_at DESC', [matchIds]);
      evRows = eR.rows;
    }
    pR.rows.forEach(p => store.players.upsert(p));
    mR.rows.forEach(m => store.matches.upsert({ ...m, player_a: m.player_a, player_b: m.player_b, match_time: m.match_time }));
    evRows.forEach(e => store.events.insert({ ...e, match_id: e.match_id, event_type: e.event_type, player_name: e.player_name }));
    const t = tR.rows[0] ?? store.timer.get();
    store.timer.patch({ timerSeconds: t.timer_seconds, matchState: t.match_state, liveMatchId: t.live_match_id, videoUrl: t.video_url });
    const dbSettings = { ...DEFAULT_SETTINGS, ...(sR.rows[0]?.settings ?? {}) };
    store.settings.merge(dbSettings);
    return {
      players: pR.rows.map(shapePlayer),
      matches: mR.rows.map(shapeMatch),
      matchEvents: evRows.map(shapeEvent),
      timerSeconds: t.timer_seconds ?? 0, matchState: t.match_state ?? 'IDLE',
      liveMatchId: t.live_match_id, videoUrl: t.video_url ?? '',
      settings: dbSettings,
      admins: aR.rows.map(a => ({ id: a.id, email: a.email, role: a.role, isActive: a.is_active })),
      _mode: 'postgres',
    };
  }
  const t = store.timer.get();
  const allMatches = store.matches.all();
  const matchIds = allMatches.map(m => m.id);
  return {
    players: store.players.all().map(shapePlayer),
    matches: allMatches.map(shapeMatch),
    matchEvents: store.events.forMatches(matchIds).map(shapeEvent),
    timerSeconds: t.timer_seconds ?? 0, matchState: t.match_state ?? 'IDLE',
    liveMatchId: t.live_match_id, videoUrl: t.video_url ?? '',
    settings: { ...DEFAULT_SETTINGS, ...store.settings.get() },
    admins: store.adminUsers.all().map(a => ({ id: a.id, email: a.email, role: a.role, isActive: a.is_active })),
    _mode: 'memory',
  };
}

const STATE_TTL = 2000; // ms — max staleness (live match data, so keep short)

app.get('/api/tournament/state', async (req, res, next) => {
  try {
    const now = Date.now();
    // Serve from cache if fresh (≤ TTL) without touching DB at all
    if (_stateCache && (now - _stateCache.ts) < STATE_TTL) {
      // ETag: return 304 if client already has this version
      if (req.headers['if-none-match'] === _stateCache.etag) {
        return res.status(304).end();
      }
      res.setHeader('ETag', _stateCache.etag);
      res.setHeader('Cache-Control', 'public, max-age=2, stale-while-revalidate=4');
      return res.json(_stateCache.json);
    }
    // In-flight dedup: if a DB query is already running, wait for it instead of spawning a new one
    if (!_stateInflight) {
      _stateInflight = buildStatePayload().finally(() => { _stateInflight = null; });
    }
    const payload = await _stateInflight;
    const json = payload;
    const etag = `"${crypto.createHash('md5').update(JSON.stringify(json)).digest('hex')}"`;
    _stateCache = { etag, json, ts: Date.now() };

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=2, stale-while-revalidate=4');
    res.json(json);
  } catch (error) { next(error); }
});

// Invalidate state cache after any write (players/matches/timer/settings mutations)
function invalidateStateCache() { _stateCache = null; }

// ── GET/PATCH /api/tournament/settings ───────────────────────────────────────
app.get('/api/tournament/settings', async (_req, res, next) => {
  try {
    if (isDbAvailable()) {
      const { rows } = await dbQuery('SELECT settings FROM tournament_settings WHERE id = 1 LIMIT 1');
      return res.json({ ...DEFAULT_SETTINGS, ...(rows[0]?.settings ?? {}) });
    }
    res.json({ ...DEFAULT_SETTINGS, ...store.settings.get() });
  } catch (error) { next(error); }
});

app.patch('/api/tournament/settings', async (req, res, next) => {
  try {
    const patch = req.body ?? {};
    store.settings.merge(patch); // always update memory
    if (isDbAvailable()) {
      const { rows } = await dbQuery(
        `INSERT INTO tournament_settings (id, settings, updated_at) VALUES (1,$1::jsonb,now())
         ON CONFLICT (id) DO UPDATE SET settings = tournament_settings.settings || $1::jsonb, updated_at = now() RETURNING settings`,
        [JSON.stringify(patch)]
      );
      return res.json(rows[0]?.settings ?? {});
    }
    res.json(store.settings.get());
  } catch (error) { next(error); }
});

// ── Players CRUD ──────────────────────────────────────────────────────────────
app.post('/api/tournament/players', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    // Unique seed ID: P- + 10 uppercase hex chars from crypto — zero collision risk
    const id = (b.id && String(b.id).trim()) || ('P-' + crypto.randomBytes(5).toString('hex').toUpperCase());
    const dbRow = {
      id, name: b.name || 'Anonymous', seed: b.seed ?? '—',
      status: b.status ?? 'Active', goals: b.goals ?? 0, shots: b.shots ?? 0, matches: b.matches ?? 0,
      gmail_address: b.gmail ?? null, cell_phone: b.cellPhone ?? null,
      whatsapp_contact: b.whatsapp ?? null, photo_url: b.photoUrl ?? null,
      preferred_keeper: b.preferredKeeper ?? null, dominant_foot: b.dominantFoot ?? 'Right',
      city: b.city ?? 'Faisalabad', bio: b.bio ?? null, best_skills: b.bestSkills ?? null,
      game_videos: Array.isArray(b.gameVideos) ? b.gameVideos : [],
      payment_status: b.paymentStatus ?? 'NOT_SUBMITTED', payment_ref: b.paymentRef ?? null,
      payment_method: b.paymentMethod ?? 'EasyPaisa/Cash',
      approval_status: b.approvalStatus ?? 'PENDING',
      checked_in: Boolean(b.checkedIn), notes: b.notes ?? null,
    };
    store.players.upsert(dbRow);
    let savedRow = dbRow;
    if (isDbAvailable()) {
      const { rows } = await dbQuery(
        `INSERT INTO tournament_players (id,name,seed,status,goals,shots,matches,gmail_address,cell_phone,whatsapp_contact,photo_url,preferred_keeper,dominant_foot,city,bio,best_skills,game_videos,payment_status,payment_ref,payment_method,approval_status,checked_in,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,seed=COALESCE(EXCLUDED.seed,tournament_players.seed),status=COALESCE(EXCLUDED.status,tournament_players.status),goals=COALESCE(EXCLUDED.goals,tournament_players.goals),shots=COALESCE(EXCLUDED.shots,tournament_players.shots),matches=COALESCE(EXCLUDED.matches,tournament_players.matches),gmail_address=COALESCE(EXCLUDED.gmail_address,tournament_players.gmail_address),cell_phone=COALESCE(EXCLUDED.cell_phone,tournament_players.cell_phone),whatsapp_contact=COALESCE(EXCLUDED.whatsapp_contact,tournament_players.whatsapp_contact),photo_url=COALESCE(EXCLUDED.photo_url,tournament_players.photo_url),preferred_keeper=COALESCE(EXCLUDED.preferred_keeper,tournament_players.preferred_keeper),dominant_foot=COALESCE(EXCLUDED.dominant_foot,tournament_players.dominant_foot),city=COALESCE(EXCLUDED.city,tournament_players.city),bio=COALESCE(EXCLUDED.bio,tournament_players.bio),best_skills=COALESCE(EXCLUDED.best_skills,tournament_players.best_skills),game_videos=COALESCE(EXCLUDED.game_videos,tournament_players.game_videos),payment_status=COALESCE(EXCLUDED.payment_status,tournament_players.payment_status),payment_ref=COALESCE(EXCLUDED.payment_ref,tournament_players.payment_ref),payment_method=COALESCE(EXCLUDED.payment_method,tournament_players.payment_method),approval_status=COALESCE(EXCLUDED.approval_status,tournament_players.approval_status),checked_in=COALESCE(EXCLUDED.checked_in,tournament_players.checked_in),notes=COALESCE(EXCLUDED.notes,tournament_players.notes),updated_at=now()
         RETURNING *`,
        [id, dbRow.name, dbRow.seed, dbRow.status, dbRow.goals, dbRow.shots, dbRow.matches,
          dbRow.gmail_address, dbRow.cell_phone, dbRow.whatsapp_contact, dbRow.photo_url, dbRow.preferred_keeper,
          dbRow.dominant_foot, dbRow.city, dbRow.bio, dbRow.best_skills, JSON.stringify(dbRow.game_videos),
          dbRow.payment_status, dbRow.payment_ref, dbRow.payment_method, dbRow.approval_status,
          dbRow.checked_in, dbRow.notes]
      );
      savedRow = rows[0];

      // If admin provided a password, create/update a users row so the player can log in
      if (b.password && dbRow.gmail_address) {
        const passwordHash = await hashPassword(String(b.password));
        await dbQuery(
          `INSERT INTO users (email, password_hash, role, is_active)
           VALUES ($1, $2, 'PLAYER', true)
           ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true`,
          [dbRow.gmail_address.toLowerCase(), passwordHash]
        );
      }
    }
    invalidateStateCache();
    res.json(savedRow);
  } catch (error) { next(error); }
});

app.patch('/api/tournament/players/:id', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const memPatch = {
      name: b.name, seed: b.seed, status: b.status,
      goals: b.goals, shots: b.shots, matches: b.matches,
      gmail_address: b.gmail, cell_phone: b.cellPhone, whatsapp_contact: b.whatsapp,
      photo_url: b.photoUrl, preferred_keeper: b.preferredKeeper, dominant_foot: b.dominantFoot,
      city: b.city, bio: b.bio, best_skills: b.bestSkills,
      game_videos: b.gameVideos,
      payment_status: b.paymentStatus, payment_ref: b.paymentRef, payment_method: b.paymentMethod,
      approval_status: b.approvalStatus, checked_in: b.checkedIn, notes: b.notes,
    };
    const memRow = store.players.patch(req.params.id, memPatch);
    if (!memRow && !isDbAvailable()) return res.status(404).json({ error: 'Player not found.' });
    if (isDbAvailable()) {
      const { rows } = await dbQuery(
        `UPDATE tournament_players SET name=COALESCE($2,name),seed=COALESCE($3,seed),status=COALESCE($4,status),goals=COALESCE($5,goals),shots=COALESCE($6,shots),matches=COALESCE($7,matches),gmail_address=COALESCE($8,gmail_address),cell_phone=COALESCE($9,cell_phone),whatsapp_contact=COALESCE($10,whatsapp_contact),photo_url=COALESCE($11,photo_url),preferred_keeper=COALESCE($12,preferred_keeper),dominant_foot=COALESCE($13,dominant_foot),city=COALESCE($14,city),bio=COALESCE($15,bio),best_skills=COALESCE($16,best_skills),game_videos=CASE WHEN $17::jsonb IS NOT NULL THEN $17::jsonb ELSE game_videos END,payment_status=COALESCE($18,payment_status),payment_ref=COALESCE($19,payment_ref),payment_method=COALESCE($20,payment_method),approval_status=COALESCE($21,approval_status),checked_in=COALESCE($22,checked_in),notes=COALESCE($23,notes),updated_at=now() WHERE id=$1 RETURNING *`,
        [req.params.id, b.name, b.seed, b.status, b.goals, b.shots, b.matches,
          b.gmail, b.cellPhone, b.whatsapp, b.photoUrl, b.preferredKeeper,
          b.dominantFoot, b.city, b.bio, b.bestSkills,
          b.gameVideos ? JSON.stringify(b.gameVideos) : null,
          b.paymentStatus, b.paymentRef, b.paymentMethod, b.approvalStatus,
          typeof b.checkedIn === 'boolean' ? b.checkedIn : null, b.notes]
      );
      if (!rows.length) return res.status(404).json({ error: 'Player not found.' });

      // If admin provided a new password, update the users row
      if (b.password && rows[0].gmail_address) {
        const passwordHash = await hashPassword(String(b.password));
        await dbQuery(
          `INSERT INTO users (email, password_hash, role, is_active)
           VALUES ($1, $2, 'PLAYER', true)
           ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = true`,
          [rows[0].gmail_address.toLowerCase(), passwordHash]
        );
      }

      invalidateStateCache();
      return res.json(rows[0]);
    }
    invalidateStateCache();
    res.json(memRow);
  } catch (error) { next(error); }
});

// Bulk-delete: DELETE /api/tournament/players  body: { ids: [...] }
app.delete('/api/tournament/players', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
    if (!ids.length) return res.status(400).json({ error: 'No ids provided.' });
    ids.forEach(id => store.players.delete(id));
    if (isDbAvailable()) await dbQuery('DELETE FROM tournament_players WHERE id = ANY($1::text[])', [ids]);
    invalidateStateCache();
    res.status(204).end();
  } catch (error) { next(error); }
});

app.delete('/api/tournament/players/:id', async (req, res, next) => {
  try {
    store.players.delete(req.params.id);
    if (isDbAvailable()) await dbQuery('DELETE FROM tournament_players WHERE id = $1', [req.params.id]);
    invalidateStateCache();
    res.status(204).end();
  } catch (error) { next(error); }
});

// ── Matches CRUD ──────────────────────────────────────────────────────────────
app.post('/api/tournament/matches', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const id = (b.id && String(b.id).trim()) || ('M-' + crypto.randomBytes(5).toString('hex').toUpperCase());
    const dbRow = {
      id, round: b.round || 'Round 1', player_a: b.playerA, player_b: b.playerB,
      score_a: b.scoreA ?? 0, score_b: b.scoreB ?? 0, match_time: b.time ?? '18:00',
      state: b.state ?? 'UPCOMING', video_url: b.videoUrl ?? null, video_title: b.videoTitle ?? null,
    };
    store.matches.upsert(dbRow);
    if (isDbAvailable()) {
      const { rows } = await dbQuery(
        `INSERT INTO tournament_matches (id,round,player_a,player_b,score_a,score_b,match_time,state,video_url,video_title)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO UPDATE SET round=EXCLUDED.round,player_a=EXCLUDED.player_a,player_b=EXCLUDED.player_b,score_a=EXCLUDED.score_a,score_b=EXCLUDED.score_b,match_time=EXCLUDED.match_time,state=EXCLUDED.state,video_url=COALESCE(EXCLUDED.video_url,tournament_matches.video_url),video_title=COALESCE(EXCLUDED.video_title,tournament_matches.video_title),updated_at=now()
         RETURNING *`,
        [id, dbRow.round, dbRow.player_a, dbRow.player_b, dbRow.score_a, dbRow.score_b,
          dbRow.match_time, dbRow.state, dbRow.video_url, dbRow.video_title]
      );
      invalidateStateCache();
      return res.json(rows[0]);
    }
    invalidateStateCache();
    res.json(store.matches.find(id));
  } catch (error) { next(error); }
});

app.patch('/api/tournament/matches/:id', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const memPatch = {
      round: b.round, player_a: b.playerA, player_b: b.playerB,
      score_a: b.scoreA, score_b: b.scoreB, match_time: b.time,
      state: b.state, video_url: b.videoUrl, video_title: b.videoTitle,
    };
    const memRow = store.matches.patch(req.params.id, memPatch);
    if (!memRow && !isDbAvailable()) return res.status(404).json({ error: 'Match not found.' });
    if (isDbAvailable()) {
      const current = await dbQuery('SELECT * FROM tournament_matches WHERE id=$1 LIMIT 1', [req.params.id]);
      if (!current.rows.length) return res.status(404).json({ error: 'Match not found.' });
      const prev = current.rows[0];
      const { rows } = await dbQuery(
        `UPDATE tournament_matches SET round=COALESCE($2,round),player_a=COALESCE($3,player_a),player_b=COALESCE($4,player_b),score_a=COALESCE($5,score_a),score_b=COALESCE($6,score_b),match_time=COALESCE($7,match_time),state=COALESCE($8,state),video_url=COALESCE($9,video_url),video_title=COALESCE($10,video_title),updated_at=now() WHERE id=$1 RETURNING *`,
        [req.params.id, b.round, b.playerA, b.playerB, b.scoreA, b.scoreB, b.time, b.state, b.videoUrl, b.videoTitle]
      );
      if (b.state === 'FINISHED' && prev.state !== 'FINISHED') {
        const fa = b.scoreA ?? prev.score_a ?? 0, fb = b.scoreB ?? prev.score_b ?? 0;
        const na = b.playerA ?? prev.player_a, nb = b.playerB ?? prev.player_b;
        await dbQuery('UPDATE tournament_players SET matches=matches+1, goals=goals+$1 WHERE name=$2', [fa, na]);
        await dbQuery('UPDATE tournament_players SET matches=matches+1, goals=goals+$1 WHERE name=$2', [fb, nb]);
      }
      invalidateStateCache();
      return res.json(rows[0]);
    }
    invalidateStateCache();
    res.json(memRow);
  } catch (error) { next(error); }
});

app.delete('/api/tournament/matches/:id', async (req, res, next) => {
  try {
    store.matches.delete(req.params.id);
    if (isDbAvailable()) {
      await dbQuery('DELETE FROM tournament_events WHERE match_id=$1', [req.params.id]);
      await dbQuery('DELETE FROM tournament_matches WHERE id=$1', [req.params.id]);
      await dbQuery("UPDATE tournament_timer SET live_match_id=NULL,match_state='IDLE' WHERE id=1 AND live_match_id=$1", [req.params.id]);
    }
    invalidateStateCache();
    res.status(204).end();
  } catch (error) { next(error); }
});

// ── Events ────────────────────────────────────────────────────────────────────
app.post('/api/tournament/events', async (req, res, next) => {
  try {
    const b = req.body ?? {};
    const row = store.events.insert(b);
    if (isDbAvailable()) {
      const { rows } = await dbQuery(
        `INSERT INTO tournament_events (id,match_id,minute,event_type,player_name,detail,side)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING RETURNING *`,
        [row.id, b.matchId, b.minute || '00:00', b.type || 'ACTION', b.player ?? '', b.detail ?? '', b.side ?? 'A']
      );
      invalidateStateCache();
      return res.json(rows[0] ?? row);
    }
    invalidateStateCache();
    res.json(row);
  } catch (error) { next(error); }
});

app.delete('/api/tournament/events/:id', async (req, res, next) => {
  try {
    store.events.delete(req.params.id);
    if (isDbAvailable()) await dbQuery('DELETE FROM tournament_events WHERE id=$1', [req.params.id]);
    invalidateStateCache();
    res.status(204).end();
  } catch (error) { next(error); }
});

// ── Timer ─────────────────────────────────────────────────────────────────────
app.patch('/api/tournament/timer', async (req, res, next) => {
  try {
    const { timerSeconds, matchState, liveMatchId } = req.body ?? {};
    store.timer.patch({ timerSeconds, matchState, liveMatchId });
    if (isDbAvailable()) {
      await dbQuery(
        `UPDATE tournament_timer SET timer_seconds=COALESCE($1,timer_seconds),match_state=COALESCE($2,match_state),live_match_id=$3,updated_at=now() WHERE id=1`,
        [timerSeconds, matchState, liveMatchId ?? null]
      );
    }
    invalidateStateCache();
    res.status(204).end();
  } catch (error) { next(error); }
});

app.patch('/api/tournament/video', async (req, res, next) => {
  try {
    const { videoUrl } = req.body ?? {};
    store.timer.patch({ videoUrl: videoUrl ?? '' });
    if (isDbAvailable()) await dbQuery('UPDATE tournament_timer SET video_url=$1,updated_at=now() WHERE id=1', [videoUrl ?? '']);
    invalidateStateCache();
    res.status(204).end();
  } catch (error) { next(error); }
});

// ── Admin management ──────────────────────────────────────────────────────────
app.post('/api/tournament/admins', async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const role = req.body?.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'ADMIN';
    if (!email.includes('@') || password.length < 12) return res.status(400).json({ error: 'Valid email and password of at least 12 characters are required.' });
    if (isDbAvailable()) {
      const passwordHash = await hashPassword(password);
      const { rows } = await dbQuery(
        `INSERT INTO users (email,password_hash,role,is_active) VALUES ($1,$2,$3,true)
         ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,is_active=true,updated_at=now()
         RETURNING id,email,role,is_active,created_at`,
        [email, passwordHash, role]
      );
      return res.status(201).json({ admin: rows[0] });
    }
    return res.status(503).json({ error: 'Database unavailable — admin accounts cannot be created in memory mode.' });
  } catch (error) { next(error); }
});

// ── Unified login — system auto-detects admin vs player from email+password ──
// Priority: 1) .env admin  2) DB admin  3) DB player  4) memory player
app.post('/api/tournament/auth/login', authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '').trim();
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    // 1. .env admin (always available, no DB needed)
    const envEmail = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
    const envPass  = (process.env.SEED_ADMIN_PASSWORD || '').trim();
    if (envEmail && email === envEmail && envPass && password === envPass) {
      return res.json({ ok: true, role: 'ADMIN', admin: { email: envEmail, role: 'SUPER_ADMIN' } });
    }

    // 2. DB admin user
    if (isDbAvailable()) {
      const { rows: adminRows } = await dbQuery(
        "SELECT id,email,password_hash,role,is_active FROM users WHERE LOWER(email)=$1 AND role IN ('ADMIN','SUPER_ADMIN') LIMIT 1",
        [email]
      );
      if (adminRows.length && adminRows[0].is_active && await verifyPassword(password, adminRows[0].password_hash)) {
        return res.json({ ok: true, role: 'ADMIN', admin: { id: adminRows[0].id, email: adminRows[0].email, role: adminRows[0].role } });
      }

      // 3. DB player — matched by gmail, verified by password
      const { rows: playerRows } = await dbQuery(
        'SELECT * FROM tournament_players WHERE LOWER(gmail_address)=$1 LIMIT 1', [email]
      );
      if (playerRows.length) {
        // Players store their password in the users table linked by gmail
        const { rows: userRows } = await dbQuery(
          "SELECT password_hash FROM users WHERE LOWER(email)=$1 AND role='PLAYER' LIMIT 1", [email]
        );
        const validPass = userRows.length ? await verifyPassword(password, userRows[0].password_hash) : false;
        if (validPass) {
          const p = playerRows[0];
          return res.json({ ok: true, role: 'PLAYER', player: shapePlayerLogin(p) });
        }
        // Player exists but password not in users table (legacy/admin-added) — allow by gmail only if no password set
        if (!userRows.length) {
          const p = playerRows[0];
          return res.json({ ok: true, role: 'PLAYER', player: shapePlayerLogin(p) });
        }
      }
    }

    // 4. Memory player fallback (offline mode) — match by gmail, no password enforcement
    const memPlayer = store.players.findByGmail(email);
    if (memPlayer) {
      return res.json({ ok: true, role: 'PLAYER', player: shapePlayerLogin(memPlayer) });
    }

    return res.status(401).json({ error: 'No account found with this email, or password is incorrect.' });
  } catch (error) { next(error); }
});

// Keep legacy routes working (in case anything calls them directly)
app.post('/api/tournament/auth/admin-login', async (req, res, next) => {
  req.body = { ...req.body, _forceAdmin: true };
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '').trim();
  const envEmail = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  const envPass  = (process.env.SEED_ADMIN_PASSWORD || '').trim();
  if (envEmail && email === envEmail && envPass && password === envPass) {
    return res.json({ ok: true, admin: { email: envEmail, role: 'SUPER_ADMIN' } });
  }
  if (isDbAvailable()) {
    try {
      const { rows } = await dbQuery("SELECT id,email,password_hash,role,is_active FROM users WHERE LOWER(email)=$1 AND role IN ('ADMIN','SUPER_ADMIN') LIMIT 1", [email]);
      if (rows.length && rows[0].is_active && await verifyPassword(password, rows[0].password_hash)) {
        return res.json({ ok: true, admin: { id: rows[0].id, email: rows[0].email, role: rows[0].role } });
      }
    } catch { /* fall through */ }
  }
  return res.status(401).json({ error: 'Unauthorized.' });
});

app.post('/api/tournament/auth/player-login', async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    let p = null;
    if (isDbAvailable()) {
      const { rows } = await dbQuery('SELECT * FROM tournament_players WHERE LOWER(gmail_address)=$1 OR LOWER(id)=$1 LIMIT 1', [email]);
      if (rows.length) p = rows[0];
    }
    if (!p) p = store.players.findByGmail(email);
    if (!p) return res.status(404).json({ error: 'No player profile found with this Gmail. Please register first.' });
    res.json({ ok: true, player: shapePlayerLogin(p) });
  } catch (error) { next(error); }
});

function shapePlayerLogin(p) {
  return {
    id: p.id, name: p.name, seed: p.seed, status: p.status,
    goals: p.goals ?? 0, shots: p.shots ?? 0, matches: p.matches ?? 0,
    gmail: p.gmail_address ?? '', cellPhone: p.cell_phone ?? '',
    whatsapp: p.whatsapp_contact ?? '', photoUrl: p.photo_url ?? '',
    preferredKeeper: p.preferred_keeper ?? '', dominantFoot: p.dominant_foot ?? 'Right',
    city: p.city ?? 'Faisalabad', bio: p.bio ?? '', bestSkills: p.best_skills ?? '',
    gameVideos: typeof p.game_videos === 'string' ? JSON.parse(p.game_videos) : (p.game_videos ?? []),
    paymentStatus: p.payment_status ?? 'NOT_SUBMITTED',
    approvalStatus: p.approval_status ?? 'PENDING',
    checkedIn: Boolean(p.checked_in), notes: p.notes ?? '',
  };
}

// ── Static serving ────────────────────────────────────────────────────────────
const frontendDir = path.resolve(__dirname, '../frontend');
// Explicit HTML routes first — prevents express.static from intercepting /index.html
app.get('/', (_req, res) => res.sendFile(path.join(frontendDir, 'UI.html')));
app.get('/ui', (_req, res) => res.sendFile(path.join(frontendDir, 'UI.html')));
app.get('/index.html', (_req, res) => res.redirect(301, '/'));
// Serve assets (images, etc.) — exclude .html so no stale index.html is served
app.use(express.static(frontendDir, { index: false, extensions: [] }));

app.use((error, _request, response, _next) => {
  console.error('Unhandled API error:', error);
  if (response.headersSent) return;
  response.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(port, '0.0.0.0', () => {
  store.seedEnvAdmin();
  console.log(`Faisalabad 1v1 API listening on http://0.0.0.0:${port}`);
});

const shutdown = async () => { await pool.end(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
