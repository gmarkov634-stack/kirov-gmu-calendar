import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendar } from "../src/calendar.js";

test("buildCalendar emits floating local study time for KГМУ", () => {
  const result = buildCalendar({
    group: "132",
    timezone: "Europe/Moscow",
    events: [{
      id: "132-20260127-histology",
      title: "Лекция: Гистология, эмбриология, цитология",
      start: "2026-01-27T08:00:00.000Z",
      end: "2026-01-27T09:30:00.000Z",
      location: "1 корпус, аудитория 411, ул. Владимирская, 137",
    }],
  });

  assert.match(result, /BEGIN:VCALENDAR/);
  assert.match(result, /UID:132-20260127-histology@kgmu-calendar/);
  assert.match(result, /DTSTART:20260127T110000/);
  assert.match(result, /DTEND:20260127T123000/);
  assert.doesNotMatch(result, /BEGIN:VTIMEZONE/);
  assert.doesNotMatch(result, /TZID=/);
  assert.doesNotMatch(result, /X-WR-TIMEZONE/);
  assert.doesNotMatch(result, /DTSTART[^\r\n]*Z/);
  assert.match(result, /Переносы/);
  assert.match(result, /END:VCALENDAR/);
});

test("ОмГМУ floating ICS always keeps the official lesson clock time", () => {
  const result = buildCalendar({
    university: "omgmu",
    universityName: "ОмГМУ",
    timezone: "Asia/Omsk",
    group: { code: "1101", displayName: "Группа 1101" },
    events: [{
      id: "omgmu-1101-2026-07-13-0900",
      title: "Гистология, эмбриология, цитология",
      start: "2026-07-13T09:00:00+06:00",
      end: "2026-07-13T11:25:00+06:00",
      location: "",
    }],
  });

  assert.match(result, /DTSTART:20260713T090000/);
  assert.match(result, /DTEND:20260713T112500/);
  assert.doesNotMatch(result, /BEGIN:VTIMEZONE/);
  assert.doesNotMatch(result, /TZID=/);
  assert.doesNotMatch(result, /X-WR-TIMEZONE/);
  assert.doesNotMatch(result, /DTSTART:20260713T030000Z/);
});
