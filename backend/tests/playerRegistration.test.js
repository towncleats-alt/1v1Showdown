import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlayerRegistration } from '../playerRegistration.js';

test('rejects incomplete registration payload', () => {
  assert.throws(() => validatePlayerRegistration({ name: 'Ali', phone: '0300' }), /Name, email, phone, and WhatsApp are required/i);
});

test('accepts valid player registration data', () => {
  const result = validatePlayerRegistration({
    name: 'Ali Khan',
    email: 'ali@example.com',
    phone: '+923001234567',
    whatsapp: '+923001234567',
  });

  assert.equal(result.name, 'Ali Khan');
  assert.equal(result.email, 'ali@example.com');
  assert.equal(result.phone, '+923001234567');
  assert.equal(result.whatsapp, '+923001234567');
});
