import { MultiUniversityStore } from "./university-store.js";
import { scheduleRequestForActiveMode } from "./archive-test-mode.js";

export class ArchiveTestMultiUniversityStore extends MultiUniversityStore {
  async getSchedule(input) {
    return super.getSchedule(scheduleRequestForActiveMode(input, this.config));
  }

  async listScheduleGroups(input) {
    return super.listScheduleGroups(scheduleRequestForActiveMode(input, this.config));
  }
}
