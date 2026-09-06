#!/usr/bin/env node
import { runExplicitMedicineCoursePublication } from './lib/publish-explicit-medicine-course.mjs';

const GROUPS = Array.from({ length: 16 }, (_, index) => String(401 + index));
const EXPECTED_GROUP_EVENT_COUNTS = Object.fromEntries(
  GROUPS.map((groupId) => [groupId, Number(groupId) <= 410 ? 144 : 145])
);

await runExplicitMedicineCoursePublication({
  scope: '401-416',
  groups: GROUPS,
  approvedSourceSha256: 'fb79b4c7b08b8f85bd2f238f2190404ea5eae01ab2be47339985272b565ead6b',
  approvedCandidateDigest: 'sha256:a38c8269bfd22ea511e9a91fa433dc0c5ae073defcd9722d08c9f6afb2511f1f',
  approvedEventCount: 2310,
  expectedGroupEventCounts: EXPECTED_GROUP_EVENT_COUNTS,
  includeGroupEventCountsInSummary: true
});
