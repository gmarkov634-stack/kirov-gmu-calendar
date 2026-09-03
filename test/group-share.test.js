import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildMaxShareUrl,
  buildPublicGroupUrl,
  buildVkShareUrl,
  findSelectionInCatalog,
  parsePublicSelection,
  referralSource
} from "../landing/group-share.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const selection = Object.freeze({ faculty: "pediatrics", course: 1, group: "131" });

test("public group deep links accept only known faculties and numeric course/group", () => {
  assert.deepEqual(
    parsePublicSelection("?faculty=pediatrics&course=1&group=131&src=max-share"),
    selection
  );
  assert.equal(parsePublicSelection("?faculty=unknown&course=1&group=131"), null);
  assert.equal(parsePublicSelection("?faculty=pediatrics&course=x&group=131"), null);
  assert.equal(parsePublicSelection("?faculty=pediatrics&course=1&group=131%2Fsecret"), null);
  assert.equal(referralSource("?src=max-share"), "max-share");
  assert.equal(referralSource("?src=vk-share"), "vk-share");
  assert.equal(referralSource("?src=anything-else"), null);
});

test("public share URL drops unrelated query and never carries protected calendar credentials", () => {
  const url = new URL(buildPublicGroupUrl(
    "https://gmarkov634-stack.github.io/kirov-gmu-calendar/?payment=return&token=SECRET#token=SECRET",
    selection,
    "max-share"
  ));

  assert.equal(url.origin, "https://gmarkov634-stack.github.io");
  assert.equal(url.pathname, "/kirov-gmu-calendar/");
  assert.equal(url.searchParams.get("faculty"), "pediatrics");
  assert.equal(url.searchParams.get("course"), "1");
  assert.equal(url.searchParams.get("group"), "131");
  assert.equal(url.searchParams.get("src"), "max-share");
  assert.equal(url.searchParams.get("payment"), null);
  assert.equal(url.searchParams.get("token"), null);
  assert.equal(url.hash, "");
  assert.doesNotMatch(url.toString(), /SECRET|webcal|calendarPath/i);
});

test("MAX receives encoded message with the public group URL", () => {
  const publicUrl = buildPublicGroupUrl(
    "https://gmarkov634-stack.github.io/kirov-gmu-calendar/",
    selection,
    "max-share"
  );
  const max = new URL(buildMaxShareUrl(publicUrl, selection));

  assert.equal(max.origin, "https://max.ru");
  assert.equal(max.pathname, "/:share");
  assert.match(max.searchParams.get("text"), /Расписание группы 131 КГМУ/);
  assert.match(max.searchParams.get("text"), /src=max-share/);
  assert.doesNotMatch(max.searchParams.get("text"), /webcal:\/\//i);
});

test("VK receives only the public landing URL", () => {
  const publicUrl = buildPublicGroupUrl(
    "https://gmarkov634-stack.github.io/kirov-gmu-calendar/",
    selection,
    "vk-share"
  );
  const vk = new URL(buildVkShareUrl(publicUrl));

  assert.equal(vk.origin, "https://vk.com");
  assert.equal(vk.pathname, "/share.php");
  assert.equal(vk.searchParams.get("url"), publicUrl);
  assert.match(vk.searchParams.get("url"), /src=vk-share/);
});

test("management resolves a group through the public catalog and rejects ambiguous matches", () => {
  const catalog = {
    programs: [
      { programId: "pediatrics", courses: [{ course: 1, groupIds: ["131", "132"] }] },
      { programId: "medicine", courses: [{ course: 1, groupIds: ["101"] }] }
    ]
  };
  assert.deepEqual(findSelectionInCatalog(catalog, "131"), selection);

  catalog.programs[1].courses[0].groupIds.push("131");
  assert.equal(findSelectionInCatalog(catalog, "131"), null);
});

test("both deploy builders load group sharing on landing and management", async () => {
  for (const path of ["deploy/build-pages.sh", "deploy/build-landing.sh"]) {
    const builder = await read(path);
    assert.match(builder, /\.\/group-share\.js/);
    assert.match(builder, /\.\.\/group-share\.js/);
  }
});

test("share UI waits for the protected calendar handoff but never builds a public URL from it", async () => {
  const script = await read("landing/group-share.js");
  assert.match(script, /calendar-device-action\[href\^="webcal:\/\/"\]/);
  assert.match(script, /buildPublicGroupUrl\(publicBaseUrl, selection/);
  assert.doesNotMatch(script, /buildPublicGroupUrl\([^\n]*(?:iphone|calendar-device-action|calendarPath|lastCalendarUrl)/);
  assert.match(script, /Отправить в MAX/);
  assert.match(script, /Отправить ВКонтакте/);
});
