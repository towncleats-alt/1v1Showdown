# Faisalabad 1v1 Implementation Audit

Date: 2026-09-15

## A. What already exists

- Vite + React public frontend with a premium Faisalabad 1v1 visual system.
- Responsive hero, live strip, fixtures, bracket preview, scorer list, match timeline, score card, footer, mobile navigation, reduced-motion CSS, and page metadata.
- One frontend `LOGIN` entry point with player/admin/scorer role selector and local portal views.
- Node.js + Express API with Helmet, CORS, JSON parsing, PostgreSQL pool, graceful shutdown, `/health`, and one API-key-protected tournament read endpoint.
- Docker Compose PostgreSQL 16 service with persistent volume and health check.
- Initial relational schema for tournaments, users, players, matches, match participants/routing, match events, and audit logs.
- Migration runner and environment-based database configuration.
- Frontend build, Docker startup, initial migration, API health, and API-key rejection have previously been verified.

## B. What is partially implemented

- Login is presentation-only: it does not authenticate credentials, create a session, or enforce permissions.
- Role routing is local React state and can be selected by any visitor.
- Public tournament, fixture, bracket, player, score, and event data comes from `src/data.js`, not PostgreSQL.
- Timer and goal buttons are browser-local state; no transaction, event persistence, idempotency, or realtime broadcast exists.
- Database has a user role column but no sessions, password reset, permissions, login audit, or auth routes.
- Match and bracket tables store useful primitives, but no domain service/state transition engine exists.
- Audit log storage exists but no command writes to it yet.
- API key is an integration gate, not user authentication and not a substitute for RBAC.
- Portal screens are operational UI shells, not connected admin/player applications.

## C. What is missing

- Real authentication, secure sessions, logout/revocation, password hashing, throttling, and server-side role authorization.
- Permission matrix and protected route middleware.
- Tournament/player registration and check-in workflows.
- Backend match state machine, authoritative timer, scoring commands, undo/correction, official results, and idempotency.
- Dynamic bracket progression, seeding, overrides, scheduling conflict detection, fields, staff assignment, and tournament lock mode.
- Derived statistics and player journey read models.
- WebSocket/SSE realtime delivery, outbox, reconnect/reconciliation, and stale-state handling.
- Admin command center, CMS, media/video storage metadata, notifications, exports, and settings UI.
- Public API-backed pages, player profile routes, match detail routes, SEO route metadata, and content empty/error/loading states.
- Automated unit, integration, E2E, load, security, backup/restore, and migration tests.
- CI/CD, staging/production configuration, observability, backups, and deployment runbooks.

## D. Database changes required

Immediate:

- Add sessions, login attempts/throttle data, roles, permissions, role-permission links, and authentication audit records.
- Add a migration ledger so migrations are applied once and in order.

Next domain migrations:

- Add tournament settings/content, registrations, check-in records, fields, staff assignments, result/official-result fields, timing pause segments, idempotency keys, outbox events, and media metadata.
- Add soft-archive fields where historical records must survive.
- Add optimistic-lock/version and uniqueness constraints to all critical command paths.

## E. Backend routes required

Immediate:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- Protected role/permission middleware.

Next:

- Tournament/settings, players/registrations/check-in, matches/state commands, events/undo/correction, bracket/routing, schedule/conflicts, statistics, content, media, notifications, exports, audit, and system readiness routes.

All command routes must validate input, authorization, state transitions, transactions, idempotency, and safe error responses.

## F. Frontend/admin pages required

Existing public shell and portal shells should be preserved.

Required next surfaces:

- Real login/error/loading states and session restoration.
- Admin dashboard with live/upcoming/delayed/alerts/system health.
- Tournament settings, players, registration/check-in, matches, live control, bracket, schedule, statistics, users/roles, audit, CMS, media, settings, and exports.
- Player dashboard backed by the authenticated player identity.
- Public API-backed live, fixtures, results, bracket, player profiles, stats, media, news, announcements, venue, rules, and match details.

## G. Security requirements

- Never trust frontend role, score, match state, player ID, or permissions.
- Use password hashing, HTTP-only secure cookies, session expiry/revocation, login throttling, generic credential errors, strict CORS, validation, safe SQL parameters, and server-side RBAC.
- Keep API keys and database credentials outside source control and frontend bundles.
- Add CSRF strategy for cookie-authenticated state-changing requests.
- Audit privileged changes and protect audit history from ordinary mutation.
- Validate media MIME/type/size and use object storage rather than application-local large binaries.
- Add security headers, dependency checks, authorization tests, and rate-limit coverage.

## H. Testing requirements

- Unit: auth/session utilities, role permissions, match transitions, scoring, bracket routing, scheduling, statistics.
- Integration: login/logout/me, authorization, migration, transactional scoring, idempotency, audit, bracket progression.
- E2E: admin login through player approval/check-in, match start, goal, public update, finish, official result, bracket/stat updates.
- Failure: invalid transitions, duplicate commands, refresh/reconnect, concurrent admins, database failure, realtime failure, backup restore.
- Build, lint/format, dependency/security scan, migration checks, and mobile/browser checks in CI.

## I. Migration plan

1. Establish real authentication, sessions, RBAC, and migration ledger.
2. Add tournament configuration, registrations, check-in, fields, and staff assignment.
3. Implement backend match state machine and authoritative timing.
4. Implement transactional scoring, events, corrections, undo, official results, and audit/outbox.
5. Implement bracket/routing, seeding, scheduling, conflict detection, and lock mode.
6. Implement derived statistics and authenticated player read models.
7. Add realtime transport and authoritative reconciliation.
8. Connect existing public and portal UI to API contracts.
9. Build the complete admin command center and CMS/media operations.
10. Add notifications, exports, hardening, automated tests, backups, observability, and deployment.

## J. Recommended implementation order

The highest-leverage missing foundation is authentication and RBAC. Without it, every admin command and player dashboard would be insecure. The first implementation slice therefore adds database-backed sessions, password hashing, login/logout/me endpoints, server-side role checks, login throttling, and audit records while preserving the current frontend shell.
