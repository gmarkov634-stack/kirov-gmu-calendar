#!/usr/bin/env node
import { runExplicitMedicineCoursePublication } from './lib/publish-explicit-medicine-course.mjs';
import { verifyMedicine501516IcsPersonalization } from '../src/medicine-501-516-ics-verification.js';

const GROUPS = Array.from({ length: 16 }, (_, index) => String(501 + index));
const EXPECTED_GROUP_EVENT_COUNTS = Object.fromEntries(GROUPS.map((groupId) => [groupId, 150]));
const IOS_VALARM_RENDERER_BLOB = 'a9b61d6bb5da412e2f6ff0b5b85474af41e6216e';

await runExplicitMedicineCoursePublication({
  scope: '501-516',
  groups: GROUPS,
  approvedSourceSha256: '43ecb37de9db7ba69153c8514f62de0b058e51c2032e0ee320b117378a740c62',
  approvedCandidateDigest: 'sha256:369dbe3d7e0aa5709e06ba0ab0ed1c079d0ec88f89216fe869cbc331ac60f7a1',
  approvedEventCount: 2400,
  expectedGroupEventCounts: EXPECTED_GROUP_EVENT_COUNTS,
  compatibleRendererBlobs: [
    { blob: IOS_VALARM_RENDERER_BLOB, label: 'ios-valarm-hotfix' }
  ],
  reportRendererCompatibility: true,
  verifyPublishedIcs: verifyMedicine501516IcsPersonalization,
  formatIcsVerificationLog: ({ groupId, verification }) =>
    `group ${groupId}: ICS personalization verified; default=${verification.defaultEventCount}; stream-1=${verification.selectedEventCounts['stream-1']}; stream-2=${verification.selectedEventCounts['stream-2']}`,
  finalResultFields: { icsPersonalizationVerified: true }
});
