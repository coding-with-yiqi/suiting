"""Regression checks for the actual filter code embedded in Backchannel."""

import ast
import logging
from pathlib import Path
import re
import unittest




SOURCE = Path(__file__).resolve().parents[1] / "app/services/batch_transcriber.py"
BINARY = None


def load_filter():
    # Evaluate only the dependency-free text filter and its constants.
    tree = ast.parse(SOURCE.read_text())
    nodes = [
        node for node in tree.body
        if isinstance(node, (ast.Assign, ast.AnnAssign, ast.FunctionDef))
        and not (isinstance(node, ast.FunctionDef) and node.name == "_audio_has_speech_energy")
    ]
    namespace = {"re": re, "logging": logging}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), "exec"), namespace)
    return namespace["filter_transcript_text"]


class ChineseFilterTests(unittest.TestCase):
    def test_spoken_chinese_without_spaces(self):
        text = "今天讨论会议安排，明天下午三点开始。"
        self.assertEqual(FILTER(text), text)

    def test_traditional_chinese(self):
        text = "請大家確認會議時間。"
        self.assertEqual(FILTER(text), text)

    def test_long_chinese_sentence(self):
        text = "我们需要确认下一阶段的任务负责人和交付时间，然后同步给所有参会人员。"
        self.assertEqual(FILTER(text), text)

    def test_mixed_chinese_and_english(self):
        self.assertEqual(FILTER("使用DeepSeek分析会议"), "使用DeepSeek分析会议")

    def test_two_character_chinese_response(self):
        self.assertEqual(FILTER("好的"), "好的")

    def test_short_noise_stays_filtered(self):
        for text in ("嗯", "okay", "Hello", "...", "", "   "):
            with self.subTest(text=text):
                self.assertIsNone(FILTER(text))

    def test_english_sentence_is_unchanged(self):
        text = "We will meet tomorrow."
        self.assertEqual(FILTER(text), text)

    def test_trim_is_preserved(self):
        self.assertEqual(FILTER("  明天开会。  "), "明天开会。")

    def test_known_hallucinations_stay_filtered(self):
        for text in ("Thank you for watching", "[BLANK_AUDIO]", "In In In In In In"):
            with self.subTest(text=text):
                self.assertIsNone(FILTER(text))


FILTER = load_filter()

if __name__ == "__main__":
    unittest.main()
