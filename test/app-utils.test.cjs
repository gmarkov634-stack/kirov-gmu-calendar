const test = require("node:test");
const assert = require("node:assert/strict");
const { findPurchasedOrder, orderPageUrl } = require("../app-utils.js");

const first = { orderId: "a".repeat(32), accessToken: "x".repeat(43) };
const second = { orderId: "b".repeat(32), accessToken: "y".repeat(43) };

test("finds a succeeded saved order for the selected group", async () => {
  const orders = new Map([
    [first.orderId, { status: "succeeded", group: "135" }],
    [second.orderId, { status: "succeeded", group: "136" }],
  ]);

  const result = await findPurchasedOrder(136, [first, second], async (orderId) => orders.get(orderId));

  assert.deepEqual(result, { ...second, order: orders.get(second.orderId) });
  assert.equal(orderPageUrl(result.orderId, result.accessToken), `#order=${second.orderId}&access=${second.accessToken}`);
});

test("does not treat pending, failed, or another group's orders as purchased", async () => {
  const entries = [first, second];
  const pending = await findPurchasedOrder("136", entries, async (orderId) => (
    orderId === first.orderId ? { status: "pending", group: "136" } : { status: "succeeded", group: "135" }
  ));
  const failed = await findPurchasedOrder("136", entries, async () => { throw new Error("offline"); });

  assert.equal(pending, null);
  assert.equal(failed, null);
});
