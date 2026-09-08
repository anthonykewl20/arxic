import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('visual_gen', pathlib.Path(__file__).with_name('gen_timing_dataset.py'))
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

spec2 = importlib.util.spec_from_file_location('visual_train', pathlib.Path(__file__).with_name('train.py'))
train = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(train)


class TimingDatasetBoundary(unittest.TestCase):
    def test_generates_valid_deterministic_rows_at_the_spec_bound(self):
        rows = gen.generate(10000, seed=423)
        self.assertEqual(len(rows), 10000)
        train.validate_rows(rows)  # same admission rules as real datasets
        again = gen.generate(10000, seed=423)
        self.assertEqual(rows, again)
        other = gen.generate(10000, seed=424)
        self.assertNotEqual(rows[0]['features'], other[0]['features'])
        # Labels are balanced per head and groups never split.
        positives = sum(r['labels'][0] == 1 for r in rows)
        self.assertGreater(positives, 4500)
        self.assertLess(positives, 5500)
        groups = {}
        for r in rows:
            groups.setdefault(r['group'], set()).add(r['split'])
        self.assertTrue(all(len(v) == 1 for v in groups.values()))
        self.assertEqual(len(groups), 50)

    def test_refuses_out_of_bounds_requests(self):
        with self.assertRaisesRegex(ValueError, 'bound'):
            gen.generate(10001, seed=423)
        with self.assertRaisesRegex(ValueError, 'bound'):
            gen.generate(0, seed=423)


if __name__ == '__main__':
    unittest.main()
