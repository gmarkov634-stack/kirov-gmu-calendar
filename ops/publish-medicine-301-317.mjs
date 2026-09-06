#!/usr/bin/env node
import { runExplicitMedicineStreamsPublication } from './lib/publish-explicit-medicine-streams.mjs';

await runExplicitMedicineStreamsPublication({
  streams: ['301-310', '311-317'],
  evidenceScopeLabel: 'course-3'
});
