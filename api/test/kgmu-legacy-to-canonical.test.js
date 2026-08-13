import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  legacyReviewedBundleToCanonicalPackage,
  legacyReviewedGroupToCanonicalPackage,
} from "../src/adapters/kgmu/legacy-to-canonical.mjs";
import { validateScheduleBatch } from "../src/schedule/validate.js";

const realBundlePath = new URL("../../reviewed/kgmu/2025-26/2/medicine/4/146876a71f1ad8503593aeb82fcc72fef76022896b85d7f7dc61ca7ec97c0dae.json", import.meta.url);

function loadRealBundle() {
  return JSON.parse(fs.readFileSync(realBundlePath, "utf8"));
}

test("real reviewed KGMU group 401 migrates to canonical schedule-batch without guessing lesson kinds", () => {
  const pkg = legacyReviewedGroupToCanonicalPackage(loadRealBundle(), {
    group: "401",
    week1StartDate: "2026-02-02",
  });
  assert.equal(pkg.format, "canonical-reviewed/v1");
  assert.equal(pkg.batches.length, 1);
  const batch = pkg.batches[0];
  assert.equal(batch.schedule.group, "401");
  assert.deepEqual(batch.schedule.period, {
    start_date: "2026-02-02",
    end_date: "2026-05-22",
    week1_start_date: "2026-02-02",
  });
  assert.equal(batch.events.length, 112);

  const counts = Object.fromEntries([...batch.events.reduce((map, event) => {
    const key = `${event.lesson.type.raw}->${event.lesson.type.code}`;
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map())]);
  assert.deepEqual(counts, {
    "practice->practice": 87,
    "lecture->lecture": 8,
    "physical_education->physical_education": 16,
    "project_defense->other": 1,
  });
  assert.ok(batch.events.every((event) => event.source.file_hash === "sha256:146876a71f1ad8503593aeb82fcc72fef76022896b85d7f7dc61ca7ec97c0dae"));
  assert.ok(batch.events.some((event) => event.source.references.some((ref) => ref.range === "C13:R13")));
  assert.equal(batch.events.find((event) => event.lesson.type.raw === "project_defense")?.lesson.discipline.normalized, "ЗАЩИТА ПРОЕКТА — МЕНЕДЖМЕНТ В ЗДРАВООХРАНЕНИИ");

  const qa = validateScheduleBatch(batch);
  assert.equal(qa.publishable, true, JSON.stringify(qa.errors));
  assert.equal(qa.errors.length, 0);
});

test("confirmed official source overlap is marked R69 only for group 408 on 2026-03-23", () => {
  const batch = legacyReviewedGroupToCanonicalPackage(loadRealBundle(), {
    group: "408",
    week1StartDate: "2026-02-02",
  }).batches[0];

  const confirmed = batch.events.filter((event) => event.parse.rule_ids.includes("R69"));
  assert.equal(confirmed.length, 2);
  assert.deepEqual(
    confirmed.map((event) => ({
      range: event.source.references[0]?.range,
      date: event.timing.date,
      start: event.timing.start_time,
      end: event.timing.end_time,
    })),
    [
      { range: "AQ20:AX20", date: "2026-03-23", start: "12:00", end: "15:05" },
      { range: "BX41", date: "2026-03-23", start: "14:45", end: "16:15" },
    ],
  );
  assert.ok(batch.events.filter((event) => !confirmed.includes(event)).every((event) => !event.parse.rule_ids.includes("R69")));

  const qa = validateScheduleBatch(batch);
  assert.equal(qa.publishable, true, JSON.stringify(qa.errors));
  assert.equal(qa.errors.length, 0);
  assert.equal(qa.stats.overlaps, 1);
  assert.equal(qa.stats.confirmed_overlaps, 1);
  assert.equal(qa.warnings.length, 1);
  assert.equal(qa.warnings[0].code, "CONFIRMED_OVERLAP");
});

test("whole real reviewed file 401-420 migrates as 20 independently publishable canonical batches", () => {
  const pkg = legacyReviewedBundleToCanonicalPackage(loadRealBundle(), {
    groups: "all",
    week1StartDate: "2026-02-02",
  });
  assert.equal(pkg.format, "canonical-reviewed/v1");
  assert.equal(pkg.batches.length, 20);
  assert.deepEqual(pkg.batches.map((batch) => batch.schedule.group), Array.from({ length: 20 }, (_, index) => String(401 + index)));
  assert.equal(pkg.batches.reduce((sum, batch) => sum + batch.events.length, 0), 2230);

  let warningCount = 0;
  for (const batch of pkg.batches) {
    assert.equal(batch.schedule.period.week1_start_date, "2026-02-02");
    assert.equal(batch.schedule.source_files[0], "4_kurs_lechebnyy_fakultet-02-02-2026-14.xlsx");
    const qa = validateScheduleBatch(batch);
    assert.equal(qa.publishable, true, `${batch.schedule.group}: ${JSON.stringify(qa.errors)}`);
    assert.equal(qa.errors.length, 0);
    warningCount += qa.warnings.length;
    if (batch.schedule.group === "408") {
      assert.equal(qa.warnings.length, 1);
      assert.equal(qa.warnings[0].code, "CONFIRMED_OVERLAP");
    } else {
      assert.equal(qa.warnings.length, 0, `unexpected warnings for group ${batch.schedule.group}`);
    }
  }
  assert.equal(warningCount, 1);
});

test("comma-separated group selection is normalized and naturally sorted", () => {
  const pkg = legacyReviewedBundleToCanonicalPackage(loadRealBundle(), {
    groups: "420,401,410",
    week1StartDate: "2026-02-02",
  });
  assert.deepEqual(pkg.batches.map((batch) => batch.schedule.group), ["401", "410", "420"]);
});

test("migration fails closed on an unknown legacy lesson kind", () => {
  const input = loadRealBundle();
  input.groups["401"].events[0].kind = "mystery_kind";
  assert.throws(
    () => legacyReviewedGroupToCanonicalPackage(input, { group: "401", week1StartDate: "2026-02-02" }),
    (error) => error.code === "LEGACY_CANONICAL_MIGRATION_INVALID" && /Unsupported reviewed legacy kind/.test(error.message),
  );
});
