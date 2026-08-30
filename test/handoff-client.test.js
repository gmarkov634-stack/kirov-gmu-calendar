import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const acquisition = readFileSync(new URL('../landing/acquisition-ui.js', import.meta.url), 'utf8');
const handoff = readFileSync(new URL('../landing/manage/handoff.js', import.meta.url), 'utf8');

test('paid handoff captures bearer management session before downstream recovery', () => {
  assert.match(
    handoff,
    /const payload = await response\.clone\(\)\.json\(\);[\s\S]*managementToken = payload\.managementToken/
  );
  assert.match(handoff, /headers\.Authorization = `Bearer \$\{managementToken\}`/);
});

test('iPhone actions emit an actual webcal subscription URL', () => {
  for (const source of [acquisition, handoff]) {
    assert.match(source, /parsed\.protocol !== "https:" && parsed\.protocol !== "http:"/);
    assert.match(
      source,
      /return `webcal:\/\/\$\{parsed\.host\}\$\{parsed\.pathname\}\$\{parsed\.search\}\$\{parsed\.hash\}`;/
    );
    assert.doesNotMatch(source, /parsed\.protocol\s*=\s*"webcal:"/);
  }
});
