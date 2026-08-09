import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendar } from "../src/calendar.js";

test("legacy KГМУ schedule keeps existing calendar identity", () => {
  const result = buildCalendar({
    group: "132",
    events: [{
      id: "132-20260127-histology",
      title: "Лекция: Гистология, эмбриология, цитология",
      start: "2026-01-27T08:00:00.000Z",
      end: "2026-01-27T09:30:00.000Z",
      location: "1 корпус, аудитория 411, ул. Владимирская, 137",
    }],
  });
  assert.match(result, /BEGIN:VCALENDAR/);
  assert.match(result, /X-WR-CALNAME:КГМУ · Группа 132/);
  assert.match(result, /X-WR-TIMEZONE:Europe\/Moscow/);
  assert.match(result, /UID:132-20260127-histology@kgmu-calendar/);
  assert.match(result, /Переносы/);
  assert.match(result, /END:VCALENDAR/);
});

test("normalized ОмГМУ schedule uses its name timezone and arbitrary group code", () => {
  const result = buildCalendar({
    university: "omgmu",
    timezone: "Asia/Omsk",
    group: {
      id: "omgmu:medicine:4:stream-1:Л-401А",
      code: "Л-401А",
      displayName: "Группа Л-401А",
    },
    events: [{
      id: "omgmu-L-401A-20260901-anatomy",
      title: "Анатомия",
      start: "2026-09-01T02:00:00.000Z",
      end: "2026-09-01T03:30:00.000Z",
    }],
  });
  assert.match(result, /X-WR-CALNAME:ОмГМУ · Группа Л-401А/);
  assert.match(result, /X-WR-TIMEZONE:Asia\/Omsk/);
  assert.match(result, /UID:omgmu-L-401A-20260901-anatomy@omgmu-calendar/);
});
