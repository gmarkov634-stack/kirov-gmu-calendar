import tls from "node:tls";
import { randomUUID } from "node:crypto";

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

function reviewBody(review, adminUrl) {
  const classification = review?.classification || {};
  const metadata = review?.metadata || {};
  const groups = reviewGroups(review);
  return [
    "КГМУ: требуется проверка расписания",
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
    adminUrl ? `Админка: ${adminUrl}` : null,
  ].filter(Boolean).join("\n");
}

function readyBody(review, adminUrl) {
  const metadata = review?.metadata || {};
  const groups = reviewGroups(review);
  return [
    "КГМУ: новое расписание прошло QA",
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
    adminUrl ? `Админка: ${adminUrl}` : null,
  ].filter(Boolean).join("\n");
}

function headerSafe(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function encodedHeader(value) {
  return `=?UTF-8?B?${Buffer.from(headerSafe(value), "utf8").toString("base64")}?=`;
}

function base64Body(value) {
  const encoded = Buffer.from(String(value || "").replace(/\r?\n/g, "\r\n"), "utf8").toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") || "";
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const lines = [];
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(Object.assign(new Error("SMTP connection closed"), { code: "EMAIL_SMTP_CLOSED" }));
    };
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      while (buffer.includes("\r\n")) {
        const index = buffer.indexOf("\r\n");
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        lines.push(line);
        const match = line.match(/^(\d{3})([ -])/);
        if (match && match[2] === " ") {
          cleanup();
          resolve({ code: Number(match[1]), text: lines.join("\n") });
          return;
        }
      }
    };
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

async function command(socket, line, accepted) {
  if (line != null) socket.write(`${line}\r\n`);
  const response = await readResponse(socket);
  if (!accepted.includes(response.code)) {
    const error = new Error(`SMTP command failed: ${response.code} ${response.text.slice(0, 300)}`);
    error.code = "EMAIL_SMTP_REJECTED";
    error.smtpCode = response.code;
    throw error;
  }
  return response;
}

function connectTls({ host, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      servername: host,
      rejectUnauthorized: true,
    });
    const timer = setTimeout(() => {
      const error = Object.assign(new Error("SMTP connection timeout"), { code: "EMAIL_SMTP_TIMEOUT" });
      socket.destroy(error);
    }, timeoutMs);
    timer.unref?.();
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function sendSmtpMail(config, message) {
  const socket = await connectTls(config);
  try {
    await command(socket, null, [220]);
    await command(socket, `EHLO ${config.heloName || "kgmu-calendar"}`, [250]);
    await command(socket, "AUTH LOGIN", [334]);
    await command(socket, Buffer.from(config.user, "utf8").toString("base64"), [334]);
    await command(socket, Buffer.from(config.password, "utf8").toString("base64"), [235]);
    await command(socket, `MAIL FROM:<${config.from}>`, [250]);
    await command(socket, `RCPT TO:<${config.to}>`, [250, 251]);
    await command(socket, "DATA", [354]);

    const payload = [
      `From: ${encodedHeader(config.fromName || "Календарь КГМУ")} <${config.from}>`,
      `To: ${config.to}`,
      `Subject: ${encodedHeader(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${randomUUID()}@kgmu-calendar>`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64Body(message.text),
    ].join("\r\n");
    socket.write(`${payload}\r\n.\r\n`);
    const sent = await readResponse(socket);
    if (sent.code !== 250) {
      const error = new Error(`SMTP DATA failed: ${sent.code} ${sent.text.slice(0, 300)}`);
      error.code = "EMAIL_SMTP_REJECTED";
      error.smtpCode = sent.code;
      throw error;
    }
    await command(socket, "QUIT", [221]);
    return { sent: true };
  } finally {
    socket.destroy();
  }
}

function validMailbox(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(value || ""));
}

export class EmailReviewNotifier {
  constructor(config, sendMail = sendSmtpMail) {
    this.host = String(config.emailSmtpHost || "").trim();
    this.port = Number(config.emailSmtpPort || 465);
    this.user = String(config.emailSmtpUser || "").trim();
    this.password = String(config.emailSmtpPassword || "");
    this.from = String(config.emailFrom || this.user).trim();
    this.to = String(config.emailTo || "").trim();
    this.fromName = String(config.emailFromName || "Календарь КГМУ").trim();
    this.adminUrl = String(config.kgmuAdminUrl || "").trim();
    this.timeoutMs = Math.max(1000, Number(config.emailSmtpTimeoutMs || 10000));
    this.sendMail = sendMail;
  }

  get enabled() {
    return Boolean(
      this.host && Number.isInteger(this.port) && this.port > 0 && this.user && this.password &&
      validMailbox(this.from) && validMailbox(this.to)
    );
  }

  async #send(subject, text) {
    if (!this.enabled) return { sent: false, reason: "email_not_configured" };
    try {
      await this.sendMail({
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        user: this.user,
        password: this.password,
        from: this.from,
        to: this.to,
        fromName: this.fromName,
      }, { subject, text });
      return { sent: true };
    } catch (error) {
      if (!error.code) error.code = "EMAIL_NOTIFY_FAILED";
      throw error;
    }
  }

  async notifyReviewRequired(review) {
    const filename = compact(review?.metadata?.filename || "schedule.xlsx", 80);
    return this.#send(`[КГМУ] Требуется проверка: ${filename}`, reviewBody(review, this.adminUrl));
  }

  async notifyReadyToPublish(review) {
    const filename = compact(review?.metadata?.filename || "schedule.xlsx", 80);
    return this.#send(`[КГМУ] Готово к публикации: ${filename}`, readyBody(review, this.adminUrl));
  }

  async notifySystemTest() {
    return this.#send(
      "[КГМУ] Проверка email-уведомлений",
      [
        "КГМУ: тест email-уведомлений успешен.",
        "",
        "На этот адрес будут приходить сообщения о новых расписаниях, которые требуют проверки или готовы к публикации.",
        this.adminUrl ? `Админка: ${this.adminUrl}` : null,
      ].filter(Boolean).join("\n"),
    );
  }
}
