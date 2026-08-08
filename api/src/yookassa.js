import { createHmac, randomBytes, randomUUID } from "node:crypto";

const API_URL = "https://api.yookassa.ru/v3";

function paymentDescription(order) {
  return `Календарь КГМУ: группа ${order.group}, семестр ${order.semester}`.slice(0, 128);
}

function publicOrder(order) {
  return {
    orderId: order.orderId,
    status: order.status,
    group: order.group,
    amount: order.amount,
    subscriptionUrl: order.status === "succeeded" ? order.subscriptionUrl : undefined,
  };
}

export class YooKassaService {
  constructor({ config, store, fetchFn = fetch }) {
    this.config = config;
    this.store = store;
    this.fetch = fetchFn;
  }

  get enabled() {
    return Boolean(this.config.yookassaShopId && this.config.yookassaSecretKey && this.config.subscriptionSigningSecret);
  }

  async request(path, options = {}) {
    const headers = {
      Authorization: `Basic ${Buffer.from(`${this.config.yookassaShopId}:${this.config.yookassaSecretKey}`).toString("base64")}`,
      "Content-Type": "application/json",
      ...options.headers,
    };
    const response = await this.fetch(`${API_URL}${path}`, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`YooKassa request failed: ${response.status}`);
      error.status = response.status;
      error.details = body;
      throw error;
    }
    return body;
  }

  async create({ group, email, schedule }) {
    if (!this.enabled) throw new Error("Payments are not configured");
    const orderId = randomBytes(24).toString("base64url");
    const now = new Date().toISOString();
    const order = {
      version: 1,
      orderId,
      status: "creating",
      group: String(group),
      faculty: schedule.faculty,
      course: schedule.course,
      academicYear: schedule.academicYear,
      semester: schedule.semester,
      expiresAt: this.config.offerExpiresAt,
      amount: this.config.offerPrice,
      currency: "RUB",
      email,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.putOrder(orderId, order);

    const body = {
      amount: { value: order.amount, currency: order.currency },
      capture: true,
      confirmation: {
        type: "redirect",
        return_url: `${this.config.publicSiteUrl}?order=${orderId}`,
      },
      description: paymentDescription(order),
      metadata: { order_id: orderId },
    };
    if (this.config.yookassaSendReceipt) {
      body.receipt = {
        customer: { email },
        items: [{
          description: paymentDescription(order),
          quantity: "1.000",
          amount: { value: order.amount, currency: order.currency },
          vat_code: this.config.receiptVatCode,
          payment_mode: "full_payment",
          payment_subject: "service",
        }],
      };
    }

    const payment = await this.request("/payments", {
      method: "POST",
      headers: { "Idempotence-Key": randomUUID() },
      body: JSON.stringify(body),
    });
    order.status = payment.status === "succeeded" ? "pending" : payment.status;
    order.paymentId = payment.id;
    order.updatedAt = new Date().toISOString();
    await this.store.putOrder(orderId, order);
    if (payment.status === "succeeded" && payment.paid) await this.fulfill(payment);
    return { orderId, confirmationUrl: payment.confirmation?.confirmation_url };
  }

  async fulfillByPaymentId(paymentId) {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(paymentId))) throw new Error("Invalid payment id");
    const payment = await this.request(`/payments/${encodeURIComponent(paymentId)}`);
    return this.fulfill(payment);
  }

  async fulfill(payment) {
    if (payment.status !== "succeeded" || payment.paid !== true) return null;
    const orderId = payment.metadata?.order_id;
    const order = await this.store.getOrder(orderId);
    if (!order || order.paymentId && order.paymentId !== payment.id) throw new Error("Payment does not match order");
    if (payment.amount?.value !== order.amount || payment.amount?.currency !== order.currency) throw new Error("Payment amount does not match order");

    const token = createHmac("sha256", this.config.subscriptionSigningSecret).update(orderId).digest("base64url");
    const subscriptionUrl = `${this.config.publicApiUrl}/api/v1/subscriptions/${token}/calendar.ics`;
    const completedAt = new Date().toISOString();
    await this.store.putSubscription(token, {
      version: 1,
      status: "active",
      group: order.group,
      faculty: order.faculty,
      course: order.course,
      academicYear: order.academicYear,
      semester: order.semester,
      expiresAt: order.expiresAt,
      orderId,
      paymentId: payment.id,
      createdAt: completedAt,
    });
    const completed = { ...order, status: "succeeded", paymentId: payment.id, subscriptionUrl, updatedAt: completedAt };
    await this.store.putOrder(orderId, completed);
    return publicOrder(completed);
  }

  async getOrder(orderId, { reconcile = true } = {}) {
    let order = await this.store.getOrder(orderId);
    if (!order) return null;
    if (reconcile && order.status !== "succeeded" && order.paymentId) {
      const payment = await this.request(`/payments/${encodeURIComponent(order.paymentId)}`);
      if (payment.status === "succeeded" && payment.paid) {
        await this.fulfill(payment);
        order = await this.store.getOrder(orderId);
      } else if (payment.status === "canceled" && order.status !== "canceled") {
        order = { ...order, status: "canceled", updatedAt: new Date().toISOString() };
        await this.store.putOrder(orderId, order);
      }
    }
    return publicOrder(order);
  }
}
