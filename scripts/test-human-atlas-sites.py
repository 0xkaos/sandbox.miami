"""Regression checks for date-lead extraction; no raw source download needed."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('prepare_sites', Path(__file__).with_name('prepare-human-atlas-sites.py'))
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class SourceTextTests(unittest.TestCase):
    def test_html_preserves_words_ordinals_and_entities(self):
        self.assertEqual(prepare.plain('<p>5<sup>th</sup> millennium &amp; 7,400&nbsp;BC.</p><p>Later.</p>'), '5th millennium & 7,400 BC. Later.')

    def test_mentions_are_not_promoted_to_years(self):
        text = 'By the 9th to 8th millennium BC, a settlement existed. Discovered in 1994 with 1,000 images and 4,000 remains.'
        mentions = prepare.date_mentions(text)
        self.assertEqual([m['text'] for m in mentions], ['9th to 8th millennium BC'])
        self.assertTrue(all(m['status'] == 'unreviewed' and 'start' not in m for m in mentions))

    def test_relative_radiocarbon_and_duration_need_review(self):
        mentions = prepare.date_mentions('30,000–32,000 BP; 6,500 years ago; 8,000 years of art.')
        self.assertEqual([m['text'] for m in mentions], ['30,000–32,000 BP', '6,500 years ago'])
        self.assertTrue(all(m['basis'].startswith('relative') for m in mentions))

    def test_century_and_explicit_era_variants(self):
        text = 'the fifth century bc; 1st century B.C.; A.D. 700; 3,300-2,300 BCE; 970 and 980 CE'
        self.assertEqual(len(prepare.date_mentions(text)), 5)


if __name__ == '__main__':
    unittest.main()
