#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

async function loadDecisionPackage(indexPath) {
  const index = JSON.parse(await readFile(indexPath, 'utf8'));
  if (index.semanticDecisionMode !== 'operator-authored-explicit' || !index.constants) {
    throw new Error('expected operator-authored explicit decision index with constants');
  }
  const decisions = [];
  for (const partRef of index.parts) {
    const partPath = resolve(dirname(indexPath), partRef.path);
    const part = JSON.parse(await readFile(partPath, 'utf8'));
    const digest = `sha256:${sha256(canonicalJson(part.decisions))}`;
    if (digest !== partRef.decisionsDigest || digest !== part.decisionsDigest) {
      throw new Error(`decision part digest mismatch: ${partRef.path}`);
    }
    if (part.decisions.length !== partRef.decisionCount) {
      throw new Error(`decision part count mismatch: ${partRef.path}`);
    }
    decisions.push(...part.decisions);
  }
  if (decisions.length !== index.decisionCount) {
    throw new Error('decision package count mismatch');
  }
  return { index, decisions };
}

function expand(index, decisions) {
  const constants = index.constants;
  const events = [];
  for (const decision of decisions) {
    for (const groupId of decision.groups) {
      for (const date of decision.dates) {
        const eventKey = [
          groupId, date, decision.startTime, decision.endTime,
          decision.discipline, decision.lessonType, decision.sourceLocator
        ].join('|');
        events.push({
          eventId: `kgmu-${sha256(eventKey).slice(0, 24)}`,
          universityId: constants.universityId,
          groupId,
          academicPeriodId: constants.academicPeriodId,
          date,
          startTime: decision.startTime,
          endTime: decision.endTime,
          timeSemantics: constants.timeSemantics,
          discipline: decision.discipline,
          lessonType: decision.lessonType,
          teacher: constants.teacher,
          location: decision.location,
          sourceRef: { sourceId: constants.sourceId, locator: decision.sourceLocator }
        });
      }
    }
  }
  return events.sort((a, b) => [
    Number(a.groupId) - Number(b.groupId),
    a.date.localeCompare(b.date),
    a.startTime.localeCompare(b.startTime),
    a.endTime.localeCompare(b.endTime),
    a.discipline.localeCompare(b.discipline),
    a.lessonType.localeCompare(b.lessonType),
    a.sourceRef.locator.localeCompare(b.sourceRef.locator)
  ].find(value => value !== 0) ?? 0);
}

const input = process.argv[2];
if (!input) {
  throw new Error('usage: materialize-explicit-decisions.mjs <index.json> [output.json]');
}
const { index, decisions } = await loadDecisionPackage(input);
const events = expand(index, decisions);
const candidateDigest = `sha256:${sha256(canonicalJson(events))}`;
const payload = {
  encoding: 'normalized-event-array-v1',
  sourceManifestId: index.manifestId,
  sourceManifestDigest: index.manifestDigest,
  eventCount: events.length,
  candidateDigest,
  events
};
const text = `${JSON.stringify(payload)}\n`;
if (process.argv[3]) {
  await writeFile(process.argv[3], text);
} else {
  process.stdout.write(text);
}
