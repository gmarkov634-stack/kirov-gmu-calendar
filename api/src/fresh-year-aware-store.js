import { YearAwareStore } from "./year-aware-store.js";

/**
 * Production schedule reads must never trust an in-process current-schedule cache.
 *
 * The canonical publication model uses an immutable version object plus a mutable
 * current.json pointer. Different API replicas do not share the Map inherited
 * from ScheduleStore, so a cached schedule can outlive a current.json switch on
 * another replica. Clearing before each externally meaningful schedule read
 * keeps publication diff/versioning and tokenized ICS feeds aligned with the
 * shared storage pointer while leaving the underlying storage format unchanged.
 */
export class FreshYearAwareStore extends YearAwareStore {
  async getSchedule(input) {
    this.cache.clear();
    return super.getSchedule(input);
  }

  async listScheduleGroups(input) {
    this.cache.clear();
    return super.listScheduleGroups(input);
  }
}
