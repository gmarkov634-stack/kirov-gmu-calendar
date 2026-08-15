export class ScheduleReviewServiceRouter {
  constructor(services = []) {
    this.services = services.filter(Boolean);
  }

  async #resolve(reviewId) {
    for (const service of this.services) {
      if (typeof service?.queue?.getReview === "function" && await service.queue.getReview(reviewId)) return service;
    }
    return null;
  }

  async submitCanonical(reviewId, input, options) {
    const service = await this.#resolve(reviewId);
    return service ? service.submitCanonical(reviewId, input, options) : null;
  }

  async publishReview(reviewId) {
    const service = await this.#resolve(reviewId);
    return service ? service.publishReview(reviewId) : null;
  }
}
