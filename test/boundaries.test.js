import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CORE_CONTRACT_VERSION,
  CORE_OWNED_BOUNDARIES,
  KGMU_OWNED_BOUNDARIES,
  UNIVERSITY_ID,
  UNIVERSITY_TIMEZONE
} from '../src/index.js';

const REQUIRED_KGMU_BOUNDARIES = [
  'source-configuration',
  'faculty-group-catalog',
  'parser-rules',
  'mappings',
  'fixtures',
  'university-qa-rules',
  'landing',
  'vk-configuration'
];

const FORBIDDEN_SHARED_BOUNDARIES = [
  'customers',
  'commerce',
  'trial',
  'entitlements',
  'subscriptions',
  'token-lifecycle',
  'calendar-preferences',
  'postprocessing',
  'calendar-ics-api'
];

test('pins KGMU to the shared core v1 contract', () => {
  assert.equal(UNIVERSITY_ID, 'kirov-gmu');
  assert.equal(UNIVERSITY_TIMEZONE, 'Europe/Moscow');
  assert.equal(CORE_CONTRACT_VERSION, 'v1');
});

test('declares every required university-owned boundary', () => {
  assert.deepEqual([...KGMU_OWNED_BOUNDARIES], REQUIRED_KGMU_BOUNDARIES);
});

test('keeps shared business and calendar capabilities out of KGMU ownership', () => {
  for (const boundary of FORBIDDEN_SHARED_BOUNDARIES) {
    assert.equal(KGMU_OWNED_BOUNDARIES.includes(boundary), false);
    assert.equal(CORE_OWNED_BOUNDARIES.includes(boundary), true);
  }
});

test('university and core ownership sets do not overlap', () => {
  const overlap = KGMU_OWNED_BOUNDARIES.filter((item) => CORE_OWNED_BOUNDARIES.includes(item));
  assert.deepEqual(overlap, []);
});
