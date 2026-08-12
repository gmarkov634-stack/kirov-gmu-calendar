import { reviewMessage, readyMessage } from "./telegram-notifier.mjs";

const DEFAULT_API_BASE = "https://platform-api2.max.ru";

function userFromUpdate(update) {
  if (update?.user?.user_id != null) return update.user;
  if (update?.message?.sender?.user_id != null) return update.message.sender;
  return null;
}

export class MaxReviewNotifier {
  constructor(config, fetchFn = fetch) {
    this.token = String(config.maxBotToken || "").trim();
    this.adminUserId = String(config.maxAdminUserId || "").trim();
    this.apiBase = String(config.maxApiBaseUrl || DEFAULT_API_BASE).replace(/\/+$/, "");
    this.fetch = fetchFn;
  }

  get tokenConfigured() {
    return Boolean(this.token);
  }

  get enabled() {
    return Boolean(this.token && this.adminUserId);
  }

  async #request(path, options = {}) {
    if (!this.token) {
      const error = new Error("MAX bot token is not configured");
      error.code = "MAX_NOT_CONFIGURED";
      throw error;
    }
    return this.fetch(`${this.apiBase}${path}`, {
      ...options,
      headers: {
        Authorization: this.token,
        ...(options.headers || {}),
      },
    });
  }

  async #send(text) {
    if (!this.token) return { sent: false, reason: "max_not_configured" };
    if (!this.adminUserId) return { sent: false, reason: "max_admin_user_not_configured" };

    const query = new URLSearchParams({
      user_id: this.adminUserId,
      disable_link_preview: "true",
    });
    const response = await this.#request(`/messages?${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, notify: true }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = new Error(`MAX notification failed: ${response.status} ${body.slice(0, 300)}`);
      error.code = "MAX_NOTIFY_FAILED";
      throw error;
    }
    return { sent: true };
  }

  async notifyReviewRequired(review) {
    return this.#send(reviewMessage(review));
  }

  async notifyReadyToPublish(review) {
    return this.#send(readyMessage(review));
  }

  async notifySystemTest() {
    return this.#send([
      "✅ КГМУ: тест уведомлений успешен",
      "",
      "Этот чат MAX будет получать сообщения о новых расписаниях, которые требуют проверки или готовы к публикации.",
    ].join("\n"));
  }

  async discoverRecipients() {
    if (!this.token) return { configured: false, recipients: [] };
    const query = new URLSearchParams({
      limit: "100",
      timeout: "0",
      types: "bot_started,message_created",
    });
    const response = await this.#request(`/updates?${query}`, { method: "GET" });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = new Error(`MAX recipient discovery failed: ${response.status} ${body.slice(0, 300)}`);
      error.code = "MAX_DISCOVERY_FAILED";
      throw error;
    }
    const payload = await response.json();
    const unique = new Map();
    for (const update of Array.isArray(payload?.updates) ? payload.updates : []) {
      const user = userFromUpdate(update);
      if (!user || user.is_bot === true || user.user_id == null) continue;
      const id = String(user.user_id);
      unique.set(id, {
        userId: id,
        chatId: update?.chat_id != null ? String(update.chat_id) : null,
        firstName: user.first_name || user.name || null,
        lastName: user.last_name || null,
        username: user.username || null,
        updateType: update?.update_type || null,
        timestamp: update?.timestamp || null,
      });
    }
    return {
      configured: true,
      recipients: [...unique.values()].slice(-20).reverse(),
      marker: payload?.marker ?? null,
    };
  }
}
