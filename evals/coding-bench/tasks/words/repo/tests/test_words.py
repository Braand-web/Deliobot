import unittest
from words import top_words

class WordsTest(unittest.TestCase):
    def test_counts(self):
        self.assertEqual(top_words('the cat and the hat. The end!', 2), [('the', 3), ('and', 1)])
    def test_ties_alphabetical(self):
        self.assertEqual(top_words('b a c', 3), [('a', 1), ('b', 1), ('c', 1)])
    def test_apostrophes_kept(self):
        self.assertEqual(top_words("don't stop, don't", 1), [("don't", 2)])
