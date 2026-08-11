function compact(value, max = 600) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function reviewGroups(review) {
  const features = review?.classification?.features || {};
  const classified = Array.isArray(features.groupCodes) ? features.groupCodes : [];
  const counted = review?.qa?.groupCounts && typeof review.qa.groupCounts === "object" ? Object.keys(review.qa.groupCounts) : [];
  return [...new Set([...classified, ...counted])].slice(0, 30).join(", ");
}

export function reviewMessage(review) {
  const classification = review?.classification || {};
  const metadata = review?.metadata || {};
  const groups = reviewGroups(review);
  return [
    "⚠️ КГМУ: требуется проверка расписания",
    "",
    `Review ID: ${review?.reviewId || "—"}`,
    `Файл: ${compact(metadata.filename || "—", 120)}`,
    `Период: ${metadata.academicYear || "—"}, семестр ${metadata.semester || "—"}`,
    metadata.program ? `Программа: ${metadata.program}` : null,
    metadata.course ? `Курс: ${metadata.course}` : null,
    `Классификатор: ${classification.type || "UNKNOWN"}`,
    `Причина: ${review?.reason || classification.reason || "unknown"}`,
    groups ? `Группы: ${groups}` : null,
    "",
    "Автопубликация остановлена. Текущее опубликованное расписание и активные подписки не изменены.",
  ].filter(Boolean).join("\n");
}

export function readyMessage(review) {
  const metadata = review?.metadata || {};
  const groups = reviewGroups(review);
  return [
    "✅ КГМУ: новое расписание прошло QA",
    "",
    `Review ID: ${review?.reviewId || "—"}`,
    `Файл: ${compact(metadata.filename || "—", 120)}`,
    `Период: ${metadata.academicYear || "—"}, семестр ${metadata.semester || "—"}`,
    metadata.program ? `Программа: ${metadata.program}` : null,
    metadata.course ? `Курс: ${metadata.course}` : null,
    review?.parserType ? `Парсер: ${review.parserType}` : null,
    groups ? `Группы: ${groups}` : null,
    review?.qa?.eventCount != null ? `Событий: ${review.qa.eventCount}` : null,
    "",
    "Статус: READY_TO_PUBLISH. Пока publish не выполнен, подписчики продолжают получать предыдущую опубликованную версию.",
  ].filter(Boolean).join("\n");
}

export class TelegramReviewNotifier {
  constructor(config, fetchFn = fetch) {
    this.token = String(config.telegramBotToken || "").trim();
    this.chatId = String(config.telegramAdminChatId || "").trim();
    this.fetch = fetchFn;
  }

  get enabled() {
    return Boolean(this.token && this.chatId);
  }

  async #send(text) {
    if (!this.enabled) return { sent: false, reason: "telegram_not_configured" };
    const response = await this.fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = new Error(`Telegram notification failed: ${response.status} ${body.slice(0, 200)}`);
      error.code = "TELEGRAM_NOTIFY_FAILED";
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
}
