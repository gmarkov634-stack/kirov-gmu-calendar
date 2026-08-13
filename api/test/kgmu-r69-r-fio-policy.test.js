import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
test('R69: R-FIO overlap reports do not participate in publishability', () => {
  assert.doesNotMatch(read('src/adapters/kgmu/foreign-r-parser.mjs'), /extraLessonFailures\.length\|\|sourceConflicts\.length\?['"]REVIEW_REQUIRED/);
  assert.doesNotMatch(read('src/adapters/kgmu/foreign-r-generic.mjs'), /extraLessonFailures\.length\|\|sourceConflicts\.length\?['"]REVIEW_REQUIRED/);
  assert.doesNotMatch(read('src/adapters/kgmu/foreign-r-safe.mjs'), /qa\.status[^\n]*conflicts\.length/);
  const reviewed = read('src/adapters/kgmu/foreign-r-reviewed.mjs');
  const status = reviewed.slice(reviewed.indexOf('qa.status = ('), reviewed.indexOf('parsed.qa = qa;'));
  assert.doesNotMatch(status, /remainingOverlaps/);
  assert.match(status, /ambiguousLectureTimeCounts/);
  assert.match(status, /choiceDisciplineAmbiguities/);
});
