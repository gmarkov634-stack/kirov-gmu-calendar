import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPublicReferralUrl,
  buildShareText,
  createReferralId,
  normalizePublicContext,
  parseReferralContext
} from '../landing/referral-sharing.js';

test('parseReferralContext accepts only complete validated public group context', () => {
  assert.deepEqual(
    parseReferralContext('https://example.test/?faculty=pediatrics&course=1&group=131&src=success-share&rid=abcDEF12'),
    { faculty: 'pediatrics', course: 1, group: '131', source: 'success-share', rid: 'abcDEF12' }
  );
  assert.equal(parseReferralContext('https://example.test/?faculty=pediatrics&course=1'), null);
  assert.equal(parseReferralContext('https://example.test/?faculty=unknown&course=1&group=131'), null);
  assert.equal(parseReferralContext('https://example.test/?faculty=pediatrics&course=7&group=131'), null);
  assert.equal(parseReferralContext('https://example.test/?faculty=pediatrics&course=1&group=13x'), null);
  assert.equal(parseReferralContext('https://example.test/?faculty=pediatrics&course=1&group=131&rid=%3Cscript%3E'), null);
});

test('buildPublicReferralUrl strips unrelated query, auth-looking data and hash', () => {
  const url = new URL(buildPublicReferralUrl(
    'https://example.test/kirov-gmu-calendar/?payment=return&token=secret&calendar=https%3A%2F%2Fics.invalid%2Fopaque#token=secret',
    { faculty: 'pediatrics', course: 1, group: '131' },
    { source: 'success-share', referralId: 'a1b2c3d4e5f6' }
  ));
  assert.equal(url.origin, 'https://example.test');
  assert.equal(url.pathname, '/kirov-gmu-calendar/');
  assert.equal(url.hash, '');
  assert.equal(url.searchParams.get('faculty'), 'pediatrics');
  assert.equal(url.searchParams.get('course'), '1');
  assert.equal(url.searchParams.get('group'), '131');
  assert.equal(url.searchParams.get('src'), 'success-share');
  assert.equal(url.searchParams.get('rid'), 'a1b2c3d4e5f6');
  assert.equal(url.searchParams.has('payment'), false);
  assert.equal(url.searchParams.has('token'), false);
  assert.equal(url.searchParams.has('calendar'), false);
});

test('share copy contains group utility but never needs a calendar URL', () => {
  const context = normalizePublicContext({ faculty: 'pediatrics', course: 1, group: '131' });
  const text = buildShareText(context);
  assert.match(text, /группы 131/);
  assert.doesNotMatch(text, /ics|webcal|token|https?:\/\//i);
});

test('createReferralId uses only public-safe random characters', () => {
  const fakeCrypto = { getRandomValues(bytes) { bytes.fill(0xab); return bytes; } };
  const rid = createReferralId(fakeCrypto);
  assert.equal(rid, 'ababababababababab');
  assert.match(rid, /^[A-Za-z0-9_-]{6,32}$/);
});
