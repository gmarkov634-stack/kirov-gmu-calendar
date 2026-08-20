import test from "node:test";
import assert from "node:assert/strict";

import { getUniversityConfig, hasUniversity, listUniversities } from "../src/universities/registry.mjs";

test("registry contains isolated university configurations", () => {
  assert.equal(hasUniversity("kgmu"), true);
  assert.equal(hasUniversity("omgmu"), true);
  assert.equal(hasUniversity("izhgmu"), true);
  assert.equal(hasUniversity("ugmu"), true);
  assert.equal(hasUniversity("unknown"), false);

  const kgmu = getUniversityConfig("kgmu");
  const omgmu = getUniversityConfig("omgmu");
  const izhgmu = getUniversityConfig("izhgmu");
  const ugmu = getUniversityConfig("ugmu");

  assert.equal(kgmu.id, "kgmu");
  assert.equal(kgmu.source.adapter, "kgmu");
  assert.equal(kgmu.source.kind, "xlsx");
  assert.equal(kgmu.active, true);

  assert.equal(omgmu.id, "omgmu");
  assert.equal(omgmu.shortName, "ОмГМУ");
  assert.equal(omgmu.timezone, "Asia/Omsk");
  assert.equal(omgmu.timeMode, "floating");
  assert.equal(omgmu.source.kind, "pdf");
  assert.equal(omgmu.source.adapter, "omgmu");
  assert.equal(omgmu.source.productionLanguage, "ru");
  assert.deepEqual(omgmu.source.versionIdentity, ["source_page", "source_url", "sha256"]);
  assert.equal(omgmu.sitePath, "/omgmu/");
  assert.equal(omgmu.active, false);

  assert.equal(izhgmu.id, "izhgmu");
  assert.equal(izhgmu.shortName, "ИжГМУ");
  assert.equal(izhgmu.timezone, "Europe/Samara");
  assert.equal(izhgmu.timeMode, "floating");
  assert.equal(izhgmu.source.kind, "spreadsheet");
  assert.deepEqual(izhgmu.source.acceptedContainers, ["xlsx", "xls"]);
  assert.equal(izhgmu.source.adapter, "izhgmu");
  assert.equal(izhgmu.source.acquisition, "github-actions");
  assert.equal(izhgmu.source.productionLanguage, "ru");
  assert.deepEqual(izhgmu.source.versionIdentity, ["source_page", "source_url", "sha256"]);
  assert.equal(izhgmu.sitePath, "/izhgmu/");
  assert.equal(izhgmu.active, false);

  assert.equal(ugmu.id, "ugmu");
  assert.equal(ugmu.shortName, "УГМУ");
  assert.equal(ugmu.timezone, "Asia/Yekaterinburg");
  assert.equal(ugmu.timeMode, "floating");
  assert.equal(ugmu.source.kind, "pdf");
  assert.match(ugmu.source.primaryPage, /^https:\/\/usma\.ru\//);
  assert.equal(ugmu.source.pageStrategy, "per-program");
  assert.equal(ugmu.source.adapter, "ugmu");
  assert.equal(ugmu.source.productionLanguage, "ru");
  assert.deepEqual(ugmu.source.versionIdentity, ["source_page", "source_url", "sha256"]);
  assert.equal(ugmu.sitePath, "/ugmu/");
  assert.equal(ugmu.active, false);

  assert.notEqual(kgmu.source, omgmu.source);
  assert.notEqual(omgmu.source, izhgmu.source);
  assert.notEqual(izhgmu.source, ugmu.source);
  assert.equal(listUniversities().length >= 4, true);
});

test("OMGmu initial commercial parsing scope excludes masters until separately activated", () => {
  const omgmu = getUniversityConfig("omgmu");
  const enabled = omgmu.programs.filter((program) => program.initialScope).map((program) => program.id);
  const deferred = omgmu.programs.filter((program) => !program.initialScope).map((program) => program.id);

  assert.deepEqual(enabled, [
    "medicine",
    "foreign_medicine",
    "pediatrics",
    "preventive_medicine",
    "dentistry",
    "pharmacy",
  ]);
  assert.deepEqual(deferred, ["public_health_master", "psychology_master"]);
});

test("IzhGMU starts with medicine as the initial parsing scope", () => {
  const izhgmu = getUniversityConfig("izhgmu");
  const enabled = izhgmu.programs.filter((program) => program.initialScope).map((program) => program.id);
  const deferred = izhgmu.programs.filter((program) => !program.initialScope).map((program) => program.id);
  assert.deepEqual(enabled, ["medicine"]);
  assert.deepEqual(deferred, ["pediatrics", "dentistry"]);
});

test("UGMU starts fail-closed with medicine as the only initial parsing scope", () => {
  const ugmu = getUniversityConfig("ugmu");
  const enabled = ugmu.programs.filter((program) => program.initialScope).map((program) => program.id);
  const deferred = ugmu.programs.filter((program) => !program.initialScope).map((program) => program.id);
  assert.equal(ugmu.active, false);
  assert.match(ugmu.source.primaryPage, /lechebnoe-delo\/$/);
  assert.deepEqual(enabled, ["medicine"]);
  assert.deepEqual(deferred, [
    "pediatrics",
    "dentistry",
    "pharmacy",
    "preventive_medicine",
    "clinical_psychology",
  ]);
});

test("unknown university fails explicitly", () => {
  assert.throws(() => getUniversityConfig("not-a-university"), /Unknown university/);
});
