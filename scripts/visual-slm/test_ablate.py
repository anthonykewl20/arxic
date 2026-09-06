import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('visual_ablate', pathlib.Path(__file__).with_name('ablate.py'))
ablate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ablate)

# Worked example with independent expected masks: index i holds value 10+i for
# numeric features; validity bits are all 1; image cells 32..95 hold fractions.
def sample_row():
    features = [10.0 + i for i in range(16)] + [1.0] * 16
    features += [0.01 * (i - 31) for i in range(32, 96)]
    return {'id': 'one', 'group': 'app', 'split': 'train', 'features': features, 'labels': [1, None, None, None, None, None]}


class AblationBoundary(unittest.TestCase):
    def test_geometry_keeps_numeric_lane_only(self):
        out = ablate.ablate_rows([sample_row()], 'geometry')[0]['features']
        self.assertEqual(out[:32], sample_row()['features'][:32])
        self.assertEqual(out[32:], [0.0] * 64)

    def test_image_keeps_image_lane_only(self):
        out = ablate.ablate_rows([sample_row()], 'image')[0]['features']
        self.assertEqual(out[:32], [0.0] * 32)
        self.assertEqual(out[32:], sample_row()['features'][32:])

    def test_clip_only_keeps_nine_and_its_validity(self):
        source = sample_row()['features']
        out = ablate.ablate_rows([sample_row()], 'clip-only')[0]['features']
        self.assertEqual(out[9], source[9])
        self.assertEqual(out[25], source[25])
        self.assertEqual([v for i, v in enumerate(out) if v != 0.0], [source[9], source[25]])

    def test_current_geometry_drops_before_box(self):
        source = sample_row()['features']
        out = ablate.ablate_rows([sample_row()], 'current-geometry')[0]['features']
        self.assertEqual(out[:4], [0.0] * 4)
        self.assertEqual(out[16:20], [0.0] * 4)
        self.assertEqual(out[4:16], source[4:16])
        self.assertEqual(out[20:32], source[20:32])
        self.assertEqual(out[32:], [0.0] * 64)

    def test_unknown_variant_rejected_and_rows_preserved(self):
        with self.assertRaisesRegex(ValueError, 'unknown-variant'):
            ablate.ablate_rows([sample_row()], 'pixels-only')
        row = sample_row()
        out = ablate.ablate_rows([row], 'clip-only')[0]
        self.assertEqual((out['id'], out['group'], out['split'], out['labels']), (row['id'], row['group'], row['split'], row['labels']))

    def test_masked_rows_still_satisfy_trainer_validation(self):
        for variant in ablate.VARIANTS:
            rows = [dict(sample_row(), id=variant), dict(sample_row(), id=variant + '-two', labels=[0, None, None, None, None, None])]
            ablate.train.validate_rows(ablate.ablate_rows(rows, variant))


if __name__ == '__main__':
    unittest.main()
