#!/usr/bin/env python3
import unittest

from official_schedule_discovery import (
    OfficialScheduleDiscoveryError,
    parse_schedule_links,
    select_schedule_link,
)


PAGE_URL = "https://kirovgma.ru/lechebnyy-fakultet-raspisanie"


class OfficialScheduleDiscoveryTest(unittest.TestCase):
    def test_selects_exact_stream_from_current_style_schedule_page(self):
        html = """
        <html><body>
          <a href="/sites/default/files/files/2026/08/31/1078/1_lech._1_potok.xlsx">
            <span>101-110</span> (первое полугодие 2026-2027 уч. г.)
          </a>
          <a href="/sites/default/files/files/2026/09/02/1078/1_lech._2_potok.xlsx">
            111-120 (первое полугодие 2026-2027 уч. г.)
          </a>
          <a href="/not-a-workbook.pdf">101-110 (первое полугодие 2026-2027 уч. г.)</a>
        </body></html>
        """
        links = parse_schedule_links(html, PAGE_URL)
        selected = select_schedule_link(
            links,
            group_label="101-110",
            academic_year="2026-2027",
            semester_label="первое полугодие",
        )
        self.assertEqual(
            selected.url,
            "https://kirovgma.ru/sites/default/files/files/2026/08/31/1078/1_lech._1_potok.xlsx",
        )
        self.assertIn("101-110", selected.label)
        self.assertEqual(len(links), 2)

    def test_fails_closed_when_matching_stream_is_missing(self):
        links = parse_schedule_links(
            '<a href="/stream.xlsx">111-120 (первое полугодие 2026-2027 уч. г.)</a>',
            PAGE_URL,
        )
        with self.assertRaisesRegex(OfficialScheduleDiscoveryError, "found 0"):
            select_schedule_link(
                links,
                group_label="101-110",
                academic_year="2026-2027",
                semester_label="первое полугодие",
            )

    def test_fails_closed_when_page_contains_ambiguous_duplicate_matches(self):
        html = """
        <a href="/a.xlsx">101-110 (первое полугодие 2026-2027 уч. г.)</a>
        <a href="/b.xlsx">101-110 (первое полугодие 2026-2027 уч. г.)</a>
        """
        links = parse_schedule_links(html, PAGE_URL)
        with self.assertRaisesRegex(OfficialScheduleDiscoveryError, "found 2"):
            select_schedule_link(
                links,
                group_label="101-110",
                academic_year="2026-2027",
                semester_label="первое полугодие",
            )

    def test_ignores_query_string_when_identifying_xlsx_path(self):
        links = parse_schedule_links(
            '<a href="/current.XLSX?download=1">101-110 (первое полугодие 2026-2027 уч. г.)</a>',
            PAGE_URL,
        )
        self.assertEqual(len(links), 1)


if __name__ == "__main__":
    unittest.main()
