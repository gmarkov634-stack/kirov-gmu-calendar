import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const config = fs.readFileSync(new URL("../../ugmu/config.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../../ugmu/app.js", import.meta.url), "utf8");

const FIRST_STREAM_SHA = "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8";
const SECOND_STREAM_SHA = "722300a869f7ecb2939aaa240463ca7b8d6c566c60a98ae90181d67d2c7e44ca";

test("UGMU config declares both course-1 streams and preserves both source hashes", () => {
  assert.match(config, /streams:\s*\["1",\s*"2"\]/);
  assert.match(config, new RegExp(`"1":\\s*"${FIRST_STREAM_SHA}"`));
  assert.match(config, new RegExp(`"2":\\s*"${SECOND_STREAM_SHA}"`));
});

test("UGMU config maps OLD 113-124 exclusively to stream 2", () => {
  for (let group = 113; group <= 124; group += 1) {
    assert.match(config, new RegExp(`code:\\s*"ОЛД ${group}",\\s*stream:\\s*"2"`));
    assert.doesNotMatch(config, new RegExp(`code:\\s*"ОЛД ${group}",\\s*stream:\\s*"1"`));
  }
});

test("UGMU config keeps OLD 101-112 on stream 1", () => {
  for (let group = 101; group <= 112; group += 1) {
    assert.match(config, new RegExp(`code:\\s*"ОЛД ${group}",\\s*stream:\\s*"1"`));
    assert.doesNotMatch(config, new RegExp(`code:\\s*"ОЛД ${group}",\\s*stream:\\s*"2"`));
  }
});

test("UGMU frontend derives groupId and request stream from the selected group", () => {
  assert.match(app, /function groupStream\(group\)/);
  assert.match(app, /const stream = groupStream\(selectedGroup\)/);
  assert.match(app, /stream-\$\{stream\}:\$\{code\}/);
  assert.match(app, /groupId:\s*groupId\(selectedGroup\)/);
  assert.match(app, /groupCode:\s*groupCode\(selectedGroup\)/);
  assert.doesNotMatch(app, /config\.program\.stream\b/);
});

test("UGMU landing labels the combined first and second streams", () => {
  assert.match(app, /"I–II потоки"/);
});
