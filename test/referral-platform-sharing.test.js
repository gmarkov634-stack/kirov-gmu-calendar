import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMaxShareUrl,
  buildVkShareUrl
} from "../landing/referral-platform-sharing.js";

const publicReferralUrl = "https://gmarkov634-stack.github.io/kirov-gmu-calendar/?faculty=pediatrics&course=1&group=131&src=max-share&rid=abcDEF_123";

test("MAX share deeplink contains prepared text and only the public referral URL", () => {
  const share = new URL(buildMaxShareUrl(
    publicReferralUrl,
    "Я подключил расписание группы 131"
  ));

  assert.equal(share.origin, "https://max.ru");
  assert.equal(share.pathname, "/:share");
  const text = share.searchParams.get("text");
  assert.match(text, /группы 131/);
  assert.match(text, /faculty=pediatrics/);
  assert.match(text, /src=max-share/);
  assert.doesNotMatch(text, /\/calendar\//i);
  assert.doesNotMatch(text, /token=/i);
});

test("VK share route contains public referral URL and group title", () => {
  const share = new URL(buildVkShareUrl(
    publicReferralUrl.replace("src=max-share", "src=vk-share"),
    "Расписание группы 131 — КГМУ"
  ));

  assert.equal(share.origin, "https://vk.com");
  assert.equal(share.pathname, "/share.php");
  assert.match(share.searchParams.get("url"), /group=131/);
  assert.match(share.searchParams.get("url"), /src=vk-share/);
  assert.equal(share.searchParams.get("title"), "Расписание группы 131 — КГМУ");
  assert.doesNotMatch(share.searchParams.get("url"), /\/calendar\//i);
  assert.doesNotMatch(share.searchParams.get("url"), /token=/i);
});

test("platform share builders reject credential-bearing URLs", () => {
  assert.throws(
    () => buildMaxShareUrl("https://user:secret@example.com/page", "test"),
    /without credentials/
  );
  assert.throws(
    () => buildVkShareUrl("https://user:secret@example.com/page", "test"),
    /without credentials/
  );
});
