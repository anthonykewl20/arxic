import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('visual_train', pathlib.Path(__file__).with_name('train.py'))
train = importlib.util.module_from_spec(spec)
spec.loader.exec_module(train)


class TrainingBoundary(unittest.TestCase):
    def test_rejects_leakage_and_nonfinite_inputs(self):
        row = {'id': 'one', 'group': 'app', 'split': 'train', 'features': [0.0] * 96, 'labels': [None] * 6}
        with self.assertRaisesRegex(ValueError, 'group-leakage'):
            train.validate_rows([row, dict(row, id='two', split='test')])
        with self.assertRaisesRegex(ValueError, 'invalid-features'):
            train.validate_rows([dict(row, features=[float('nan')] * 96)])

    def test_gradients_against_independent_finite_differences(self):
        layers = train.initialize('mlp', 423)
        x, labels, weights = [0.1] * 96, [1, 0, None, None, None, None], [[1, 1]] * 6
        _, _, gradients = train.loss_gradient(layers, x, labels, weights)
        for layer_index, key, index in [(0, 'w', 0), (1, 'w', 15), (2, 'b', 0)]:
            layer = layers[layer_index]
            original, epsilon = layer[key][index], 1e-5
            layer[key][index] = original + epsilon
            upper = train.loss_gradient(layers, x, labels, weights)[0]
            layer[key][index] = original - epsilon
            lower = train.loss_gradient(layers, x, labels, weights)[0]
            layer[key][index] = original
            actual = gradients[layer_index][0 if key == 'w' else 1][index]
            self.assertAlmostEqual(actual, (upper-lower)/(2*epsilon), places=6)

    def test_rejects_nonfinite_artifact_and_missing_training_labels(self):
        with self.assertRaisesRegex(ValueError, 'model-header'):
            train.read_binary(b'broken')
        rows = [{'id': split, 'group': split, 'split': split, 'features': [0.] * 96, 'labels': [None] * 6} for split in ['train', 'calibration']]
        with self.assertRaisesRegex(ValueError, 'no-supported-head'):
            train.fit(rows)

    def test_threshold_selection_prefers_the_highest_qualifying_value(self):
        # Worked example: calibration scores where the qualifying band is wide.
        # Positives 0.9/0.8/0.7, negatives 0.1/0.2. Every threshold in (0.2, 0.7]
        # yields precision 1.0 and recall 1.0; the selector must pick the highest
        # qualifying candidate (0.7) so drifted negatives stay below it, not the
        # lowest (band-edge 0.2).
        scores = {'p1': [0.9, 0, 0, 0, 0, 0], 'p2': [0.8, 0, 0, 0, 0, 0], 'p3': [0.7, 0, 0, 0, 0, 0],
                  'n1': [0.1, 0, 0, 0, 0, 0], 'n2': [0.2, 0, 0, 0, 0, 0]}
        rows = [{'id': 't1', 'group': 'g', 'split': 'train', 'features': [0.] * 96, 'labels': [1, None, None, None, None, None]},
                {'id': 't2', 'group': 'g', 'split': 'train', 'features': [0.] * 96, 'labels': [0, None, None, None, None, None]}]
        rows += [{'id': i, 'group': 'c', 'split': 'calibration', 'features': [0.] * 96,
                  'labels': [1, None, None, None, None, None] if i.startswith('p') else [0, None, None, None, None, None]} for i in scores]
        thresholds = train.calibrate_thresholds(rows, lambda row_id: scores[row_id])
        self.assertAlmostEqual(thresholds[0], 0.7, places=12)
        self.assertEqual(thresholds[1:], [None] * 5)


if __name__ == '__main__':
    unittest.main()
