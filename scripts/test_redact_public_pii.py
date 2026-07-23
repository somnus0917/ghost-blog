from __future__ import annotations

import unittest

from redact_public_pii import redact_text


class RedactPublicPiiTests(unittest.TestCase):
    def test_redacts_repeated_name_and_student_number(self) -> None:
        source = (
            '{"children":[{"text":"姓名：张三，学号：2026123456。张三提交了附件。"}]}'
        )

        result, fields = redact_text(source)

        self.assertNotIn("张三", result)
        self.assertNotIn("2026123456", result)
        self.assertEqual(result.count("[已脱敏]"), 3)
        self.assertEqual(set(fields), {"name", "student_number"})

    def test_leaves_unrelated_text_unchanged(self) -> None:
        source = '{"children":[{"text":"今天完成了论文初稿。"}]}'

        result, fields = redact_text(source)

        self.assertEqual(result, source)
        self.assertEqual(fields, [])


if __name__ == "__main__":
    unittest.main()
