import test from "node:test";
import assert from "node:assert/strict";
import { TelegramReviewNotifier, readyMessage, reviewMessage } from "../src/adapters/kgmu/telegram-notifier.mjs";

const review = {
  reviewId: "11111111-1111-1111-1111-111111111111",
  status: "REVIEW_REQUIRED",
  reason: "UNKNOWN_PATTERN",
  metadata: {
    filename: "1_ped.xlsx",
    academicYear: "2026/27",
    semester: 1,
    program: "pediatrics",
    course: 1,
  },
  classification: {
    type: "UNKNOWN",
    features: { groupCodes: ["101", "102"] },
  },
};

test("review notification clearly blocks an unknown KGMU pattern", () => {
  const text = reviewMessage(review);
  assert.match(text, /требуется проверка расписания/i);
  assert.match(text, /UNKNOWN_PATTERN/);
  assert.match(text, /101, 102/);
  assert.match(text, /Автопубликация остановлена/);
  assert.match(text, /активные подписки не изменены/);
});

test("ready notification clearly says publication is still pending", () => {
  const text = readyMessage({
    ...review,
    status: "READY_TO_PUBLISH",
    reason: "QA_PASS_AWAITING_PUBLISH",
    parserType: "R",
    qa: { eventCount: 245, groupCounts: { 101: 120, 102: 125 } },
  });
  assert.match(text, /прошло QA/i);
  assert.match(text, /READY_TO_PUBLISH/);
  assert.match(text, /Событий: 245/);
  assert.match(text, /пока publish не выполнен/i);
});

test("Telegram notifier sends review to the configured admin chat", async () => {
  const calls = [];
  const notifier = new TelegramReviewNotifier({
    telegramBotToken: "123456:test-token",
    telegramAdminChatId: "285010485",
  }, async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });

  const result = await notifier.notifyReviewRequired(review);
  assert.deepEqual(result, { sent: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.telegram.org/bot123456:test-token/sendMessage");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.chat_id, "285010485");
  assert.match(body.text, /UNKNOWN_PATTERN/);
  assert.equal(body.disable_web_page_preview, true);
});

test("Telegram notifier fails closed when Telegram rejects the message", async () => {
  const notifier = new TelegramReviewNotifier({
    telegramBotToken: "123456:test-token",
    telegramAdminChatId: "285010485",
  }, async () => new Response("temporary failure", { status: 503 }));

  await assert.rejects(
    () => notifier.notifyReadyToPublish({ ...review, status: "READY_TO_PUBLISH", parserType: "R" }),
    (error) => error?.code === "TELEGRAM_NOTIFY_FAILED",
  );
});
