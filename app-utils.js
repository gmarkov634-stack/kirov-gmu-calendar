(function exposeCalendarAppUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CALENDAR_APP_UTILS = api;
}(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const validOrderId = (value) => /^[A-Za-z0-9_-]{32}$/.test(value || "");
  const validAccessToken = (value) => /^[A-Za-z0-9_-]{43}$/.test(value || "");

  function orderPageUrl(orderId, accessToken = "") {
    const params = new URLSearchParams({ order: orderId });
    if (accessToken) params.set("access", accessToken);
    return `#${params}`;
  }

  async function findPurchasedOrder(group, savedOrders, loadOrder) {
    const targetGroup = String(group);
    const matches = await Promise.all(savedOrders.map(async ({ orderId, accessToken = "" }) => {
      try {
        const order = await loadOrder(orderId, accessToken);
        if (order?.status !== "succeeded" || String(order.group) !== targetGroup) return null;
        return { orderId, accessToken, order };
      } catch {
        return null;
      }
    }));
    return matches.find(Boolean) || null;
  }

  return { validOrderId, validAccessToken, orderPageUrl, findPurchasedOrder };
}));
