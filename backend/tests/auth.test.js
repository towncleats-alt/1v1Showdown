import test from 'node:test';
import assert from 'node:assert/strict';
import { requirePermission, requireRole, verifyPassword } from '../auth.js';

const fakeResponse = () => ({
  statusCode: 200,
  json(payload) {
    this.body = payload;
    return this;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  end() { return this; },
});

test('requireRole blocks unauthorized roles', () => {
  const req = { user: { role: 'PLAYER' } };
  const res = fakeResponse();
  let nextCalled = false;
  requireRole('ADMIN','SUPER_ADMIN')(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test('requirePermission allows matching permission', () => {
  const req = { user: { permissions: ['matches.score'] } };
  const res = fakeResponse();
  let nextCalled = false;
  requirePermission('matches.score')(req, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 200);
  assert.equal(nextCalled, true);
});

test('verifyPassword rejects a bad password', async () => {
  const stored = 'scrypt$abc$' + Buffer.alloc(64, 0).toString('hex');
  const valid = await verifyPassword('wrong-password', stored);
  assert.equal(valid, false);
});
