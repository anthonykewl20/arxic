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


if __name__ == '__main__':
    unittest.main()
