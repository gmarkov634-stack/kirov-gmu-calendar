import { scheduleContext } from "./order-context.js";
import { YooKassaService } from "./yookassa.js";
import {
  archiveTestExpiry,
  isKgmuArchiveTestSchedule,
  kgmuArchiveTestPeriod,
} from "./archive-test-mode.js";

function subscriptionTokenFromUrl(value) {
  return String(value || "").match(/\/subscriptions\/([A-Za-z0-9_-]{43})\/calendar\.ics$/)?.[1] || null;
}

export class ArchiveTestYooKassaService extends YooKassaService {
  async markArchiveTest(orderId, expiresAt) {
    const order = await this.store.getOrder(orderId);
    if (!order) throw new Error("Archive test order disappeared after creation");
    const updated = {
      ...order,
      archiveTest: true,
      expiresAt,
    };
    await this.store.putOrder(orderId, updated);

    const token = subscriptionTokenFromUrl(updated.subscriptionUrl);
    if (token) {
      const subscription = await this.store.getSubscription(token);
      if (subscription) {
        await this.store.putSubscription(token, {
          ...subscription,
          archiveTest: true,
          expiresAt,
        });
      }
    }
    return updated;
  }

  async create({ email, schedule, plan = "semester" }) {
    const context = scheduleContext(schedule);
    if (!isKgmuArchiveTestSchedule(this.config, context)) {
      return super.create({ email, schedule, plan });
    }

    const period = kgmuArchiveTestPeriod(this.config);
    if (!period || this.config.yookassaTestMode !== true) {
      const error = new Error("KGMU archive purchase requires YooKassa test mode");
      error.code = "archive_test_mode_required";
      throw error;
    }

    const expiresAt = archiveTestExpiry(this.config);
    const temporaryConfig = {
      ...this.config,
      offerAcademicYear: period.academicYear,
      offerSemester: period.semester,
    };
    const temporarySchedule = {
      ...schedule,
      events: [
        ...(Array.isArray(schedule?.events) ? schedule.events : []),
        {
          id: "kgmu-archive-test-access-boundary",
          title: "Техническая граница тестового доступа",
          start: new Date(Date.parse(expiresAt) - 60_000).toISOString(),
          end: expiresAt,
        },
      ],
    };

    // Use an isolated service instance so the live shared service config is never
    // mutated while an async YooKassa request is in flight.
    const temporaryService = new YooKassaService({
      config: temporaryConfig,
      store: this.store,
      fetchFn: this.fetch,
    });
    const result = await temporaryService.create({ email, schedule: temporarySchedule, plan });
    await this.markArchiveTest(result.orderId, expiresAt);
    return result;
  }

  async fulfill(payment) {
    const orderId = payment?.metadata?.order_id;
    const before = orderId ? await this.store.getOrder(orderId) : null;
    const result = await super.fulfill(payment);
    if (!result || before?.archiveTest !== true) return result;

    const completed = await this.store.getOrder(orderId);
    const token = subscriptionTokenFromUrl(completed?.subscriptionUrl);
    if (token) {
      const subscription = await this.store.getSubscription(token);
      if (subscription) {
        await this.store.putSubscription(token, {
          ...subscription,
          archiveTest: true,
          expiresAt: before.expiresAt,
        });
      }
    }
    return result;
  }
}
