import test from "node:test";
import assert from "node:assert/strict";
import { EmailReviewNotifier } from "../src/adapters/kgmu/email-notifier.mjs";

const baseConfig = {
  emailSmtpHost: "smtp.example.test",
  emailSmtpPort: 465,
  emailSmtpUser: "sender@example.test",
  emailSmtpPassword: "app-password",
  emailFrom: "sender@example.test",
  emailFromName: "Календарь КГМУ",
  emailTo: "admin@example.test",
  kgmuAdminUrl: "https://example.test/admin.html",
};

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

test("email notifier sends blocked review through configured SMTP transport", async () => {
  const calls = [];
  const notifier = new EmailReviewNotifier(baseConfig, async (config, message) => {
    calls.push({ config, message });
    return { sent: true };
  });

  assert.equal(notifier.enabled, true);
  assert.deepEqual(await notifier.notifyReviewRequired(review), { sent: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.host, "smtp.example.test");
  assert.equal(calls[0].config.port, 465);
  assert.equal(calls[0].config.to, "admin@example.test");
  assert.match(calls[0].message.subject, /Требуется проверка/);
  assert.match(calls[0].message.subject, /1_ped\.xlsx/);
  assert.match(calls[0].message.text, /UNKNOWN_PATTERN/);
  assert.match(calls[0].message.text, /101, 102/);
  assert.match(calls[0].message.text, /Автопубликация остановлена/);
  assert.match(calls[0].message.text, /https:\/\/example\.test\/admin\.html/);
});

test("email notifier sends a distinct READY_TO_PUBLISH message", async () => {
  const calls = [];
  const notifier = new EmailReviewNotifier(baseConfig, async (config, message) => {
    calls.push({ config, message });
    return { sent: true };
  });

  const result = await notifier.notifyReadyToPublish({
    ...review,
    status: "READY_TO_PUBLISH",
    reason: "QA_PASS_AWAITING_PUBLISH",
    parserType: "R",
    qa: { eventCount: 245, groupCounts: { 101: 120, 102: 125 } },
  });
  assert.deepEqual(result, { sent: true });
  assert.match(calls[0].message.subject, /Готово к публикации/);
  assert.match(calls[0].message.text, /READY_TO_PUBLISH/);
  assert.match(calls[0].message.text, /Событий: 245/);
  assert.match(calls[0].message.text, /пока publish не выполнен/i);
});

test("email system test uses the same configured transport", async () => {
  const calls = [];
  const notifier = new EmailReviewNotifier(baseConfig, async (config, message) => {
    calls.push({ config, message });
    return { sent: true };
  });

  assert.deepEqual(await notifier.notifySystemTest(), { sent: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].message.subject, /Проверка email-уведомлений/);
  assert.match(calls[0].message.text, /тест email-уведомлений успешен/i);
});

test("email notifier fails closed when SMTP configuration is incomplete", async () => {
  let called = false;
  const notifier = new EmailReviewNotifier({ ...baseConfig, emailSmtpPassword: "" }, async () => {
    called = true;
  });

  assert.equal(notifier.enabled, false);
  assert.deepEqual(await notifier.notifyReviewRequired(review), { sent: false, reason: "email_not_configured" });
  assert.equal(called, false);
});

test("email notifier exposes transport failure to retry logic", async () => {
  const notifier = new EmailReviewNotifier(baseConfig, async () => {
    const error = new Error("temporary SMTP failure");
    error.code = "EMAIL_SMTP_TIMEOUT";
    throw error;
  });

  await assert.rejects(
    () => notifier.notifyReviewRequired(review),
    (error) => error?.code === "EMAIL_SMTP_TIMEOUT",
  );
});
