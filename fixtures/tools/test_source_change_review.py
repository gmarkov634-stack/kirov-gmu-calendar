#!/usr/bin/env python3
import unittest

from source_change_review import build_source_change_review


class SourceChangeReviewTest(unittest.TestCase):
    def test_reports_removed_and_new_cells_without_reusing_semantics(self):
        dump = {
            "sourceSha256": "new-sha",
            "nonEmptyCells": [
                {"coord": "B9", "value": "same slot"},
                {"coord": "C9", "value": "new slot"},
                {"coord": "A43", "value": "outside main table"},
            ],
        }
        decisions = {
            "sourceSha256": "old-sha",
            "decisions": [
                ["B9#s1"],
                ["B10#s1"],
                ["B10#s2"],
            ],
        }
        review = build_source_change_review(
            workbook_dump=dump,
            decisions=decisions,
            min_row=9,
            max_row=42,
            min_col=2,
            max_col=11,
        )
        self.assertEqual(review["status"], "REVIEW_REQUIRED")
        self.assertEqual(review["currentLogicalSourceCellCount"], 2)
        self.assertEqual(review["approvedLogicalSourceCellCount"], 2)
        self.assertEqual(review["missingApprovedSourceCells"], ["B10"])
        self.assertEqual(review["newUnreviewedSourceCells"], ["C9"])
        self.assertEqual(
            review["reasonCodes"],
            [
                "SOURCE_FINGERPRINT_CHANGED",
                "APPROVED_SOURCE_CELL_REMOVED",
                "UNREVIEWED_SOURCE_CELL_ADDED",
            ],
        )
        self.assertFalse(review["semanticDecisionReuseAllowed"])

    def test_changed_fingerprint_requires_review_even_when_coordinates_match(self):
        dump = {"sourceSha256": "new-sha", "nonEmptyCells": [{"coord": "B9", "value": "changed text"}]}
        decisions = {"sourceSha256": "old-sha", "decisions": [["B9#s1"]]}
        review = build_source_change_review(
            workbook_dump=dump,
            decisions=decisions,
            min_row=9,
            max_row=42,
            min_col=2,
            max_col=11,
        )
        self.assertEqual(review["reasonCodes"], ["SOURCE_FINGERPRINT_CHANGED"])
        self.assertFalse(review["semanticDecisionReuseAllowed"])

    def test_exact_fingerprint_and_cell_set_is_reusable(self):
        dump = {"sourceSha256": "same-sha", "nonEmptyCells": [{"coord": "B9", "value": "same"}]}
        decisions = {"sourceSha256": "same-sha", "decisions": [["1 леч.1!B9#s1"]]}
        review = build_source_change_review(
            workbook_dump=dump,
            decisions=decisions,
            min_row=9,
            max_row=42,
            min_col=2,
            max_col=11,
        )
        self.assertEqual(review["status"], "PASS")
        self.assertTrue(review["semanticDecisionReuseAllowed"])


if __name__ == "__main__":
    unittest.main()
