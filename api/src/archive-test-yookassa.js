import { scheduleContext } from "./order-context.js";
import { semesterEndFromSchedule } from "./subscription-period.js";
import { YooKassaService } from "./yookassa.js";
import {
  isKgmuArchiveTestSchedule,
  kgmuArchiveTestPeriod,
} from "./archive-test-mode.js";

function subscriptionTokenFromUrl(value) {
  return String(value || "").match(/\/subscriptions\/([A-Za-z0-9_-]{43})\/calendar\.ics$/)?.[1] || null;
}

export class ArchiveTestYooKassaService extends YooKassaService {
  async restoreHistoricalSemesterEnd(orderId, expiresAt) {
    const order = await this.store.getOrder(orderId);
    if (!order) throw new Error("Archive test order disappeared after creation");
    const updated = { ...order, expiresAt };
    await this.store.putOrder(orderId, updated);

    const token = subscriptionTokenFromUrl(updated.subscriptionUrl);
    if (token) {
      const subscription = await this.store.getSubscription(token);
      if (subscription) {
        await this.store.putSubscription(token, { ...subscription, expiresAt });
      }
    }
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

    const temporaryConfig = {
      ...this.config,
      offerAcademicYear: period.academicYear,
      offerSemester: period.semester,
    };

    let checkoutSchedule = schedule;
    let historicalSemesterEnd = null;
    if (plan === "semester") {
      historicalSemesterEnd = semesterEndFromSchedule(schedule);
      const temporaryEnd = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const temporaryStart = new Date(Date.parse(temporaryEnd) - 60_000).toISOString();
      checkoutSchedule = {
        ...schedule,
        events: [
          ...(Array.isArray(schedule?.events) ? schedule.events : []),
          {
            id: "kgmu-archive-test-checkout-only",
            title: "Техническая запись тестового checkout",
            start: temporaryStart,
            end: temporaryEnd,
          },
        ],
      };
    }

    // The isolated service only bypasses the historical end-date check long enough
    // to create a YooKassa TEST payment. The technical event is never published.
    const temporaryService = new YooKassaService({
      config: temporaryConfig,
      store: this.store,
      fetchFn: this.fetch,
    });
    const result = await temporaryService.create({ email, schedule: checkoutSchedule, plan });

    if (historicalSemesterEnd) {
      await this.restoreHistoricalSemesterEnd(result.orderId, historicalSemesterEnd);
    }
    return result;
  }
}
