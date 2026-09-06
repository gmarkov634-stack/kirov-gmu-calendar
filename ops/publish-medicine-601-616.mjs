#!/usr/bin/env node
import { runExplicitMedicineCoursePublication } from './lib/publish-explicit-medicine-course.mjs';

const GROUPS = Array.from({ length: 16 }, (_, index) => String(601 + index));
const EXPECTED_GROUP_EVENT_COUNTS = Object.fromEntries(GROUPS.map((groupId) => [groupId, 91]));

await runExplicitMedicineCoursePublication({
  scope: '601-616',
  groups: GROUPS,
  approvedSourceSha256: '0b5c4a06fd45e50bdaf28586fcb3f4bddade4efe514bc54dd84c359aa04fcb23',
  approvedCandidateDigest: 'sha256:4126d3adfeb289ee5e47b27a55960d748ee4aa596b227ba4922f40bf1b5b069c',
  approvedEventCount: 1456,
  expectedGroupEventCounts: EXPECTED_GROUP_EVENT_COUNTS
});
