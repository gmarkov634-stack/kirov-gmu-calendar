import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyUgmuScheduleLabel,
  discoverUgmuSources,
  extractUgmuScheduleSources,
} from "../src/adapters/ugmu/discover.mjs";

const SOURCE = "https://usma.ru/obrazovatelnaya-deyatelnost/uchebno-metodicheskoe-upravlenie/raspisanie/raspisanie-dlya-studentov-specialnosti-lechebnoe-delo/";

test("classifies UGMU course, stream and schedule part", () => {
  assert.deepEqual(classifyUgmuScheduleLabel("I поток"), {
    course: null,
    stream: "1",
    part: "combined",
  });
  assert.deepEqual(classifyUgmuScheduleLabel("4 курс лекции"), {
    course: 4,
    stream: null,
    part: "lectures",
  });
  assert.deepEqual(classifyUgmuScheduleLabel("6 курс практика"), {
    course: 6,
    stream: null,
    part: "practice",
  });
});

test("extracts only semester class PDFs and carries course context between stream links", () => {
  const html = `
    <h3>График учебных недель на осенний семестр</h3>
    <a href="/wp-content/uploads/2026/08/weeks.pdf">график</a>

    <h3>Расписание занятий на осенний семестр</h3>
    <div>1 курс
      <a href="/wp-content/uploads/2026/08/1old-1.pdf">I поток</a>,
      <a href="/wp-content/uploads/2026/08/1old-2.pdf">II поток</a>
    </div>
    <div>
      <a href="/wp-content/uploads/2026/08/4old-lek.pdf">4 курс лекции</a>
      <a href="/wp-content/uploads/2026/08/4old-prakt.pdf">4 курс практика</a>
    </div>

    <h3>Расписание зимней сессии</h3>
    <a href="/wp-content/uploads/2026/08/session.pdf">1-6 курс</a>

    <h3>Расписание занятий на весенний семестр</h3>
    <div>2 курс
      <a href="/wp-content/uploads/2027/01/2old-iii.pdf">III поток</a>
    </div>
    <a href="https://example.org/not-official.pdf">4 курс лекции</a>
  `;

  const sources = extractUgmuScheduleSources(html, { sourceUrl: SOURCE, program: "medicine" });
  assert.equal(sources.length, 5);

  assert.deepEqual(sources[0], {
    program: "medicine",
    semester: "autumn",
    course: 1,
    stream: "1",
    part: "combined",
    label: "I поток",
    url: "https://usma.ru/wp-content/uploads/2026/08/1old-1.pdf",
  });
  assert.equal(sources[1].course, 1);
  assert.equal(sources[1].stream, "2");
  assert.equal(sources[2].course, 4);
  assert.equal(sources[2].part, "lectures");
  assert.equal(sources[3].part, "practice");
  assert.equal(sources[4].semester, "spring");
  assert.equal(sources[4].course, 2);
  assert.equal(sources[4].stream, "3");
});

test("uses the latest section marker and never treats footer PDFs as schedules", () => {
  const html = `
    <h3>Расписание занятий на осенний семестр</h3>
    <div>6 курс <a href="/wp-content/uploads/2026/08/6-lek.pdf">6 курс лекции</a></div>
    <h3>Расписание занятий на весенний семестр</h3>
    <div>6 курс</div>
    <h3>Расписание государственной итоговой аттестации</h3>
    <div>6 курс</div>
    <footer>
      <a href="/wp-content/uploads/2023/12/privacy.pdf">Положение об обработке и обеспечении безопасности ПДн в УГМУ</a>
    </footer>
  `;
  const sources = extractUgmuScheduleSources(html, { sourceUrl: SOURCE, program: "medicine" });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].label, "6 курс лекции");
  assert.equal(sources[0].semester, "autumn");
});

test("discovery returns a validated fail-closed manifest without publishing", async () => {
  const html = `
    <h3>Расписание занятий на осенний семестр</h3>
    <div>1 курс <a href="/wp-content/uploads/2026/08/1old-1.pdf">I поток</a></div>
    <div><a href="/wp-content/uploads/2026/08/4old-lek.pdf">4 курс лекции</a></div>
    <div><a href="/wp-content/uploads/2026/08/4old-prakt.pdf">4 курс практика</a></div>
  `;

  const manifest = await discoverUgmuSources({
    program: "medicine",
    sourceUrl: SOURCE,
    fetchFn: async () => new Response(html, { status: 200 }),
  });

  assert.equal(manifest.university, "ugmu");
  assert.equal(manifest.program, "medicine");
  assert.equal(manifest.sourceCount, 3);
  assert.equal(manifest.validation.status, "ok");
  assert.deepEqual(manifest.validation.errors, []);
  assert.equal("published" in manifest, false);
});

test("senior-course combined source is rejected for manual review", async () => {
  const html = `
    <h3>Расписание занятий на осенний семестр</h3>
    <a href="/wp-content/uploads/2026/08/4old.pdf">4 курс</a>
  `;
  const manifest = await discoverUgmuSources({
    program: "medicine",
    sourceUrl: SOURCE,
    fetchFn: async () => new Response(html, { status: 200 }),
  });
  assert.equal(manifest.validation.status, "needs-review");
  assert.match(manifest.validation.errors.join("\n"), /senior course part needs review/);
});
