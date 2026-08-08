import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendar } from "../src/calendar.js";

test("buildCalendar produces one event with official-schedule notice", () => {
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
  assert.match(result, /UID:132-20260127-histology@kgmu-calendar/);
  assert.match(result, /Переносы/);
  assert.match(result, /END:VCALENDAR/);
});
