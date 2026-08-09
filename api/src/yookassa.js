import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { scheduleContext } from "./order-context.js";

const API_URL = "https://api.yookassa.ru/v3";

function paymentDescription(order) {
  return `Календарь ${order.universityName}: ${order.groupDisplayName}, семестр ${order.semester}`.slice(0, 128);
}

function publicOrder(order) {
  return {
    orderId: order.orderId,
    status: order.status,
    university: order.university,
    program: order.program,
    course: order.course,
    stream: order.stream,
    group: order.groupCode,
    groupCode: order.groupCode,
    groupId: order.groupId,
    groupDisplayName: order.groupDisplayName,
    amount: order.amount,
    testMode: order.testMode === true,
    subscriptionUrl: order.status === "succeeded" ? order.subscriptionUrl : undefined,
  };
}

function accessTokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function validAccessToken(token) {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

function accessAllowed(order, token) {
  if (!order.accessTokenHash) return true;
  if (!validAccessToken(token)) return false;
  const actual = Buffer.from(accessTokenHash(token), "hex");
  const expected = Buffer.from(order.accessTokenHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function subscriptionToken(config, orderId, generation = 0) {
  const input = generation === 0 ? orderId : `${orderId}:${generation}`;
  return createHmac("sha256", config.subscriptionSigningSecret).update(input).digest("base64url");
}

function forbidden() {
  const error = new Error("Order access denied");
  error.code = "order_forbidden";
  return error;
}

export class YooKassaService {
  constructor({ config, store, fetchFn = fetch }) {
    this.config = config;
    this.store = store;
    this.fetch = fetchFn;
  }

  get enabled() {
    return Boolean(
      this.config.yookassaShopId &&
      this.config.yookassaSecretKey &&
      this.config.subscriptionSigningSecret?.length >= 32 &&
      /^\d+\.\d{2}$/.test(this.config.offerPrice) &&
      Number.isFinite(Date.parse(this.config.offerExpiresAt))
    );
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

  assertPaymentMode(payment) {
    const isTestPayment = payment?.test === true;
    if (isTestPayment !== this.config.yookassaTestMode) {
      throw new Error(this.config.yookassaTestMode
        ? "YooKassa returned a real payment while test mode is enabled"
        : "YooKassa returned a test payment while production mode is enabled");
    }
  }

  async create({ email, schedule }) {
    if (!this.enabled) throw new Error("Payments are not configured");
    const context = scheduleContext(schedule);
    if (!context.university || !context.program || !context.groupCode || !context.groupId) {
      throw new Error("Schedule context is incomplete");
    }
    const orderId = randomBytes(24).toString("base64url");
    const accessToken = randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    const order = {
      version: 2,
      orderId,
      status: "creating",
      ...context,
      expiresAt: this.config.offerExpiresAt,
      amount: this.config.offerPrice,
      currency: "RUB",
      testMode: this.config.yookassaTestMode,
      email,
      accessTokenHash: accessTokenHash(accessToken),
      createdAt: now,
      updatedAt: now,
    };
    await this.store.putOrder(orderId, order);

    const body = {
      amount: { value: order.amount, currency: order.currency },
      capture: true,
      confirmation: {
        type: "redirect",
        return_url: `${this.config.publicSiteUrl}#order=${orderId}&access=${accessToken}`,
      },
      description: paymentDescription(order),
      metadata: { order_id: orderId, university: order.university, group_id: order.groupId },
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
    this.assertPaymentMode(payment);
    order.status = payment.status === "succeeded" ? "pending" : payment.status;
    order.paymentId = payment.id;
    order.updatedAt = new Date().toISOString();
    await this.store.putOrder(orderId, order);
    if (payment.status === "succeeded" && payment.paid) await this.fulfill(payment);
    return { orderId, accessToken, confirmationUrl: payment.confirmation?.confirmation_url };
  }

  async fulfillByPaymentId(paymentId) {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(paymentId))) throw new Error("Invalid payment id");
    const payment = await this.request(`/payments/${encodeURIComponent(paymentId)}`);
    return this.fulfill(payment);
  }

  async fulfill(payment) {
    if (payment.status !== "succeeded" || payment.paid !== true) return null;
    this.assertPaymentMode(payment);
    const orderId = payment.metadata?.order_id;
    const order = await this.store.getOrder(orderId);
    if (!order || order.paymentId && order.paymentId !== payment.id) throw new Error("Payment does not match order");
    if (payment.amount?.value !== order.amount || payment.amount?.currency !== order.currency) throw new Error("Payment amount does not match order");

    if (order.status === "succeeded" && order.subscriptionUrl) return publicOrder(order);
    const token = subscriptionToken(this.config, orderId);
    const subscriptionUrl = `${this.config.publicApiUrl}/api/v1/subscriptions/${token}/calendar.ics`;
    const completedAt = new Date().toISOString();
    await this.store.putSubscription(token, {
      version: 2,
      status: "active",
      university: order.university,
      universityName: order.universityName,
      program: order.program,
      course: order.course,
      stream: order.stream,
      groupCode: order.groupCode,
      groupId: order.groupId,
      groupDisplayName: order.groupDisplayName,
      timezone: order.timezone,
      academicYear: order.academicYear,
      semester: order.semester,
      expiresAt: order.expiresAt,
      orderId,
      paymentId: payment.id,
      createdAt: completedAt,
    });
    const completed = {
      ...order,
      status: "succeeded",
      paymentId: payment.id,
      subscriptionUrl,
      subscriptionGeneration: 0,
      updatedAt: completedAt,
    };
    await this.store.putOrder(orderId, completed);
    return publicOrder(completed);
  }

  async getOrder(orderId, { reconcile = true, accessToken } = {}) {
    let order = await this.store.getOrder(orderId);
    if (!order) return null;
    if (!accessAllowed(order, accessToken)) throw forbidden();
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

  async rotateSubscription(orderId, accessToken) {
    const order = await this.store.getOrder(orderId);
    if (!order) return null;
    if (!order.accessTokenHash || !accessAllowed(order, accessToken)) throw forbidden();
    return this.#rotateSubscription(order);
  }

  async rotateSubscriptionAsAdmin(orderId, expectedTokenHash) {
    const order = await this.store.getOrder(orderId);
    if (!order) return null;
    const currentToken = order.subscriptionUrl?.match(/\/subscriptions\/([A-Za-z0-9_-]{43})\/calendar\.ics$/)?.[1];
    if (!currentToken || accessTokenHash(currentToken) !== expectedTokenHash) {
      const error = new Error("Subscription is no longer current");
      error.code = "subscription_not_current";
      throw error;
    }
    return this.#rotateSubscription(order);
  }

  async #rotateSubscription(order) {
    if (order.status !== "succeeded" || !order.subscriptionUrl) {
      const error = new Error("Order is not fulfilled");
      error.code = "order_not_succeeded";
      throw error;
    }

    const currentToken = order.subscriptionUrl.match(/\/subscriptions\/([A-Za-z0-9_-]{43})\/calendar\.ics$/)?.[1];
    if (!currentToken) throw new Error("Invalid stored subscription URL");
    const current = await this.store.getSubscription(currentToken);
    if (!current) throw new Error("Current subscription is missing");
    const rotatedAt = new Date().toISOString();
    await this.store.putSubscription(currentToken, { ...current, status: "revoked", revokedAt: rotatedAt });

    const generation = Number(order.subscriptionGeneration || 0) + 1;
    const nextToken = subscriptionToken(this.config, order.orderId, generation);
    const subscriptionUrl = `${this.config.publicApiUrl}/api/v1/subscriptions/${nextToken}/calendar.ics`;
    await this.store.putSubscription(nextToken, {
      ...current,
      status: "active",
      createdAt: rotatedAt,
      rotatedFromGeneration: Number(order.subscriptionGeneration || 0),
      revokedAt: undefined,
    });
    const updated = {
      ...order,
      subscriptionUrl,
      subscriptionGeneration: generation,
      updatedAt: rotatedAt,
    };
    await this.store.putOrder(order.orderId, updated);
    return publicOrder(updated);
  }
}
