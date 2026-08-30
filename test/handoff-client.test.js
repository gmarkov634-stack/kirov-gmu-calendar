import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const handoff = readFileSync(new URL('../landing/manage/handoff.js', import.meta.url), 'utf8');

test('paid handoff captures bearer management session before downstream recovery', () => {
  assert.match(
    handoff,
    /const payload = await response\.clone\(\)\.json\(\);[\s\S]*managementToken = payload\.managementToken/
  );
  assert.match(handoff, /headers\.Authorization = `Bearer \$\{managementToken\}`/);
});

test('iPhone handoff actions accept only http or https calendar URLs', () => {
  assert.match(handoff, /parsed\.protocol !== "https:" && parsed\.protocol !== "http:"/);
  assert.match(handoff, /parsed\.protocol = "webcal:"/);
});
