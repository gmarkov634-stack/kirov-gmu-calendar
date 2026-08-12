import test from "node:test";
import assert from "node:assert/strict";
import { MaxReviewNotifier } from "../src/adapters/kgmu/max-notifier.mjs";

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

test("MAX notifier sends parser review to configured user through platform-api2", async () => {
  const calls = [];
  const notifier = new MaxReviewNotifier({
    maxBotToken: "max-secret-token",
    maxAdminUserId: "987654321",
  }, async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ message: { body: { text: "ok" } } }), { status: 200 });
  });

  assert.equal(notifier.enabled, true);
  const result = await notifier.notifyReviewRequired(review);
  assert.deepEqual(result, { sent: true });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin, "https://platform-api2.max.ru");
  assert.equal(url.pathname, "/messages");
  assert.equal(url.searchParams.get("user_id"), "987654321");
  assert.equal(url.searchParams.get("disable_link_preview"), "true");
  assert.equal(calls[0].options.headers.Authorization, "max-secret-token");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.notify, true);
  assert.match(body.text, /UNKNOWN_PATTERN/);
  assert.match(body.text, /101, 102/);
});

test("MAX notifier fails closed when MAX rejects a message", async () => {
  const notifier = new MaxReviewNotifier({
    maxBotToken: "max-secret-token",
    maxAdminUserId: "987654321",
  }, async () => new Response("temporary failure", { status: 503 }));

  await assert.rejects(
    () => notifier.notifyReadyToPublish({ ...review, status: "READY_TO_PUBLISH", parserType: "R" }),
    (error) => error?.code === "MAX_NOTIFY_FAILED",
  );
});

test("MAX notifier requires admin user id before sending", async () => {
  const notifier = new MaxReviewNotifier({ maxBotToken: "max-secret-token" }, async () => {
    throw new Error("fetch must not be called");
  });
  assert.deepEqual(await notifier.notifySystemTest(), {
    sent: false,
    reason: "max_admin_user_not_configured",
  });
});

test("MAX recipient discovery reads bot_started and message_created without duplicates", async () => {
  const calls = [];
  const notifier = new MaxReviewNotifier({ maxBotToken: "max-secret-token" }, async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({
      updates: [
        {
          update_type: "bot_started",
          timestamp: 100,
          chat_id: 7001,
          user: { user_id: 501, first_name: "Григорий", last_name: "М", username: "gm", is_bot: false },
        },
        {
          update_type: "message_created",
          timestamp: 101,
          chat_id: 7001,
          message: { sender: { user_id: 501, first_name: "Григорий", username: "gm", is_bot: false } },
        },
        {
          update_type: "message_created",
          timestamp: 102,
          chat_id: 7002,
          message: { sender: { user_id: 999, first_name: "Другой", is_bot: false } },
        },
        {
          update_type: "message_created",
          timestamp: 103,
          message: { sender: { user_id: 777, first_name: "Bot", is_bot: true } },
        },
      ],
      marker: 200,
    }), { status: 200 });
  });

  const result = await notifier.discoverRecipients();
  assert.equal(result.configured, true);
  assert.equal(result.marker, 200);
  assert.equal(result.recipients.length, 2);
  assert.deepEqual(result.recipients.map((item) => item.userId), ["999", "501"]);
  assert.equal(result.recipients[1].chatId, "7001");
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.origin, "https://platform-api2.max.ru");
  assert.equal(url.pathname, "/updates");
  assert.equal(url.searchParams.get("limit"), "100");
  assert.equal(url.searchParams.get("timeout"), "0");
  assert.equal(url.searchParams.get("types"), "bot_started,message_created");
  assert.equal(calls[0].options.headers.Authorization, "max-secret-token");
});

test("MAX discovery reports unconfigured state without exposing a token", async () => {
  const notifier = new MaxReviewNotifier({}, async () => {
    throw new Error("fetch must not be called");
  });
  assert.deepEqual(await notifier.discoverRecipients(), { configured: false, recipients: [] });
});
