#!/usr/bin/env node
import { runExplicitMedicineStreamsPublication } from './lib/publish-explicit-medicine-streams.mjs';

await runExplicitMedicineStreamsPublication({
  streams: ['201-210', '211-220'],
  evidenceScopeLabel: 'course-2'
});
