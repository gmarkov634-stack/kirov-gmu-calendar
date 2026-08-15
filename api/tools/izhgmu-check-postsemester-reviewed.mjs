#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  verifyIzhgmuMedicine6PostsemesterReview,
} from '../src/adapters/izhgmu/postsemester-reviewed.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function findFile(root, filename) {
  const candidates = [
    path.join(root, filename),
    path.join(root, 'postsemester', filename),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Reviewed IzhGMU PDF not found: ${filename}`);
  return found;
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-postsemester'));
const attestationPath = findFile(inputDir, 'medicine6-intermediate-attestation-2026.pdf');
const giaPath = findFile(inputDir, 'medicine6-gia-2026.pdf');
const verified = verifyIzhgmuMedicine6PostsemesterReview({
  intermediateAttestationBuffer: fs.readFileSync(attestationPath),
  giaBuffer: fs.readFileSync(giaPath),
});

const { analysis, observedHashes } = verified;
console.log('IZHGMU_POSTSEMESTER_REVIEWED', JSON.stringify({
  profile: analysis.profile,
  hashes: observedHashes,
  coverage: {
    hospitalTherapy: {
      entries: analysis.coverage.hospitalTherapy.entries,
      coveredGroups: analysis.coverage.hospitalTherapy.coveredGroups.length,
      missingGroups: analysis.coverage.hospitalTherapy.missingGroups,
    },
    polyclinicTherapy: {
      entries: analysis.coverage.polyclinicTherapy.entries,
      coveredGroups: analysis.coverage.polyclinicTherapy.coveredGroups.length,
      missingGroups: analysis.coverage.polyclinicTherapy.missingGroups,
    },
    phthisiology: {
      entries: analysis.coverage.phthisiology.entries,
      coveredGroups: analysis.coverage.phthisiology.coveredGroups.length,
      missingGroups: analysis.coverage.phthisiology.missingGroups,
    },
    gia: {
      entries: analysis.coverage.gia.entries,
      coveredGroups: analysis.coverage.gia.coveredGroups.length,
      missingGroups: analysis.coverage.gia.missingGroups,
    },
  },
  consultationSegments: analysis.consultationSegments,
  blockers: analysis.blockers,
  intermediateAttestationPublishable: analysis.intermediateAttestationPublishable,
  giaPublishable: analysis.giaPublishable,
  publishable: analysis.publishable,
}));
