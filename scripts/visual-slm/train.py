"""Bounded CPU-only reference trainer. Standard library only; no provider calls.

Float64 optimizer/reference arithmetic, float32 export. Native parity gates the
export. Experimental artifacts never carry production-promotion authority.
"""
import argparse
import copy
import json
import math
import pathlib
import random
import resource
import struct
import time

HEADS = ['clipping', 'occlusion', 'missing_element', 'overflow', 'text_truncation', 'layout_shift']


def validate_rows(rows):
    if not isinstance(rows, list) or not 1 <= len(rows) <= 10000:
        raise ValueError('dataset-bound')
    groups, ids = {}, set()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'id', 'group', 'split', 'features', 'labels'}:
            raise ValueError('invalid-row')
        if not all(isinstance(row[k], str) and 1 <= len(row[k]) <= 160 for k in ['id', 'group']):
            raise ValueError('invalid-id')
        if row['id'] in ids or row['split'] not in ['train', 'calibration', 'test']:
            raise ValueError('invalid-split-or-duplicate')
        ids.add(row['id'])
        if row['group'] in groups and groups[row['group']] != row['split']:
            raise ValueError('group-leakage')
        groups[row['group']] = row['split']
        x = row['features']
        if not isinstance(x, list) or len(x) != 96 or any(type(v) not in [int, float] or not math.isfinite(v) for v in x):
            raise ValueError('invalid-features')
        if any(v not in [0, 1] for v in x[16:32]) or any(not 0 <= v <= 1 for v in x[32:]):
            raise ValueError('feature-range')
        if any(x[i] != 0 and x[i + 16] == 0 for i in range(16)):
            raise ValueError('missing-feature-value')
        labels = row['labels']
        if not isinstance(labels, list) or len(labels) != 6 or any(v is not None and (type(v) is not int or v not in [0, 1]) for v in labels):
            raise ValueError('invalid-labels')
    return rows


def normalize_fit(rows):
    means, stds = [], []
    for i in range(16):
        values = [r['features'][i] for r in rows if r['features'][i + 16]]
        mean = sum(values) / len(values) if values else 0.0
        std = max(1e-6, math.sqrt(sum((v - mean) ** 2 for v in values) / len(values))) if values else 1.0
        means.append(mean)
        stds.append(std)
    return means, stds


def normalize(x, means, stds):
    return [max(-8.0, min(8.0, (x[i] - means[i]) / stds[i])) if x[i + 16] else 0.0 for i in range(16)] + x[16:]


def initialize(kind, seed):
    rng = random.Random(seed)
    dims = [96, 6] if kind == 'logistic' else [96, 64, 32, 6]
    return [{'input': a, 'output': b, 'w': [rng.gauss(0, math.sqrt(2 / a)) for _ in range(a * b)], 'b': [0.0] * b} for a, b in zip(dims, dims[1:])]


def sigmoid(value):
    if value >= 0:
        return 1 / (1 + math.exp(-value))
    e = math.exp(value)
    return e / (1 + e)


def forward(layers, x):
    activations, pre = [x], []
    for index, layer in enumerate(layers):
        n, w = layer['input'], layer['w']
        z = [sum(w[j * n + k] * activations[-1][k] for k in range(n)) + layer['b'][j] for j in range(layer['output'])]
        pre.append(z)
        activations.append([sigmoid(v) for v in z] if index == len(layers) - 1 else [max(0, v) for v in z])
    return activations, pre


def loss_gradient(layers, x, labels, weights):
    a, z = forward(layers, x)
    delta = [(p - y) * weights[j][y] if y is not None else 0.0 for j, (p, y) in enumerate(zip(a[-1], labels))]
    total = sum(weights[j][y] for j, y in enumerate(labels) if y is not None)
    loss = sum((max(v, 0) - v * y + math.log1p(math.exp(-abs(v)))) * weights[j][y] for j, (v, y) in enumerate(zip(z[-1], labels)) if y is not None)
    gradients = [None] * len(layers)
    for index in reversed(range(len(layers))):
        layer, previous = layers[index], a[index]
        n, m = layer['input'], layer['output']
        gradients[index] = ([d * v for d in delta for v in previous], delta[:])
        if index:
            delta = [sum(layer['w'][j * n + k] * delta[j] for j in range(m)) if z[index - 1][k] > 0 else 0.0 for k in range(n)]
    return loss, total, gradients


def fit(rows, kind='mlp', epochs=30):
    validate_rows(rows)
    train = [r for r in rows if r['split'] == 'train']
    calibration = [r for r in rows if r['split'] == 'calibration']
    if not train or not calibration:
        raise ValueError('missing-training-or-calibration')
    means, stds = normalize_fit(train)
    counts = [[sum(r['labels'][j] == y for r in train) for y in [0, 1]] for j in range(6)]
    supported = [all(c) for c in counts]
    if not any(supported):
        raise ValueError('no-supported-head')
    weights = [[min(10.0, sum(c) / (2 * n)) if n else 0.0 for n in c] for c in counts]
    prepared = [(normalize(r['features'], means, stds), [v if supported[j] else None for j, v in enumerate(r['labels'])]) for r in train]
    layers = initialize(kind, 423)
    moments = [([0.0] * len(l['w']), [0.0] * len(l['b']), [0.0] * len(l['w']), [0.0] * len(l['b'])) for l in layers]
    rng, step, best_loss, stale, best, history = random.Random(423), 0, math.inf, 0, copy.deepcopy(layers), []
    for epoch in range(epochs):
        order = list(range(len(prepared)))
        rng.shuffle(order)
        for start in range(0, len(order), 32):
            gradients = [([0.0] * len(l['w']), [0.0] * len(l['b'])) for l in layers]
            total = 0.0
            for index in order[start:start + 32]:
                _, count, gs = loss_gradient(layers, *prepared[index], weights)
                total += count
                for (gw, gb), (sw, sb) in zip(gradients, gs):
                    for i, value in enumerate(sw): gw[i] += value
                    for i, value in enumerate(sb): gb[i] += value
            if not total:
                continue
            step += 1
            for layer, gs, ms in zip(layers, gradients, moments):
                for key, grad, moment, variance in [('w', gs[0], ms[0], ms[2]), ('b', gs[1], ms[1], ms[3])]:
                    for i in range(len(grad)):
                        g = grad[i] / total + (0.0001 * layer[key][i] if key == 'w' else 0)
                        moment[i] = 0.9 * moment[i] + 0.1 * g
                        variance[i] = 0.999 * variance[i] + 0.001 * g * g
                        layer[key][i] -= 0.001 * (moment[i] / (1 - 0.9 ** step)) / (math.sqrt(variance[i] / (1 - 0.999 ** step)) + 1e-8)
        losses, total = 0.0, 0.0
        for row in calibration:
            labels = [v if supported[j] else None for j, v in enumerate(row['labels'])]
            loss, count, _ = loss_gradient(layers, normalize(row['features'], means, stds), labels, [[1, 1]] * 6)
            losses += loss
            total += count
        if not total: raise ValueError('missing-calibration-labels')
        value = losses / total
        history.append(value)
        if value < best_loss:
            best_loss, stale, best = value, 0, copy.deepcopy(layers)
        else:
            stale += 1
        if stale >= 5: break
    return best, means, stds, {'history': history, 'supported': supported, 'classCounts': counts, 'classWeights': weights, 'bestCalibrationLoss': best_loss}


def export_binary(layers, means, stds, kind):
    params = [value for layer in layers for key in ['w', 'b'] for value in layer[key]]
    values = means + stds + params
    if not all(math.isfinite(v) for v in values): raise ValueError('nonfinite-model')
    return b'AVSM0001' + struct.pack('<II', 0 if kind == 'logistic' else 1, len(params)) + struct.pack('<' + 'f' * len(values), *values)


def read_binary(blob):
    if len(blob) < 16 or blob[:8] != b'AVSM0001': raise ValueError('model-header')
    kind, count = struct.unpack_from('<II', blob, 8)
    if kind not in [0, 1] or count != (582 if kind == 0 else 8486) or len(blob) != 16 + 4 * (32 + count): raise ValueError('model-size')
    values = list(struct.unpack_from('<' + 'f' * (32 + count), blob, 16))
    if not all(math.isfinite(v) for v in values) or not all(v > 0 for v in values[16:32]): raise ValueError('nonfinite-model')
    layers, offset = initialize('logistic' if kind == 0 else 'mlp', 0), 32
    for layer in layers:
        for key in ['w', 'b']:
            size = len(layer[key]); layer[key] = values[offset:offset + size]; offset += size
    return layers, values[:16], values[16:32]


def wilson(success, count):
    if not count: return None
    z, p = 1.959963984540054, success / count
    denominator = 1 + z*z/count
    center = (p + z*z/(2*count))/denominator
    margin = z*math.sqrt(p*(1-p)/count + z*z/(4*count*count))/denominator
    return [max(0.0, center-margin), min(1.0, center+margin)]


def evaluate(rows, blob):
    layers, means, stds = read_binary(blob)
    scores = {r['id']: forward(layers, normalize(r['features'], means, stds))[0][-1] for r in rows}
    calibration = [r for r in rows if r['split'] == 'calibration']
    thresholds = []
    for head in range(6):
        available = [r for r in calibration if r['labels'][head] is not None]
        pos = sum(r['labels'][head] == 1 for r in available)
        neg = len(available) - pos
        threshold = None
        if pos and neg:
            for value in sorted(set(scores[r['id']][head] for r in available)):
                tp = sum(scores[r['id']][head] >= value and r['labels'][head] == 1 for r in available)
                fp = sum(scores[r['id']][head] >= value and r['labels'][head] == 0 for r in available)
                if tp and tp/(tp+fp) >= .95 and tp/pos >= .9:
                    threshold = value; break
        thresholds.append(threshold)
    metrics = []
    for head in range(6):
        test = [r for r in rows if r['split'] == 'test' and r['labels'][head] is not None]
        t = thresholds[head]
        tp = sum(t is not None and scores[r['id']][head] >= t and r['labels'][head] == 1 for r in test)
        fp = sum(t is not None and scores[r['id']][head] >= t and r['labels'][head] == 0 for r in test)
        pos = sum(r['labels'][head] == 1 for r in test); neg = len(test)-pos
        metrics.append({'head': HEADS[head], 'positives': pos, 'negatives': neg, 'tp': tp, 'fp': fp, 'unresolvedPositive': pos-tp, 'precision': tp/(tp+fp) if tp+fp else None, 'recall': tp/pos if pos else None, 'precision95': wilson(tp,tp+fp), 'recall95': wilson(tp,pos), 'falsePositiveRate95': wilson(fp,neg)})
    return {'scores': scores, 'positiveThresholds': thresholds, 'testMetrics': metrics, 'promotion': 'blocked', 'blockers': ['experimental-model', 'independent-application-quality-gates-not-established', 'full-vps-not-measured'], 'coverage': 'supplied-regions-only'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('dataset'); parser.add_argument('output'); parser.add_argument('--epochs', type=int, default=30)
    args = parser.parse_args()
    if not 1 <= args.epochs <= 30: raise ValueError('epoch-bound')
    source = pathlib.Path(args.dataset)
    if source.stat().st_size > 32 * 1024 * 1024: raise ValueError('dataset-bound')
    rows = validate_rows(json.loads(source.read_text()))
    output = pathlib.Path(args.output)
    output.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    report = {'version': 1, 'seed': 423, 'arithmetic': 'float64-training-float32-export', 'models': {}}
    for kind in ['logistic', 'mlp']:
        start = time.monotonic()
        layers, means, stds, training = fit(rows, kind, args.epochs)
        blob = export_binary(layers, means, stds, kind)
        (output / (kind + '.bin')).write_bytes(blob)
        report['models'][kind] = {'training': training, 'bytes': len(blob), 'elapsedSeconds': time.monotonic()-start, **evaluate(rows, blob)}
    report['elapsedSeconds'] = time.monotonic()-started
    report['peakRssKiB'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    (output / 'training-report.json').write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')


if __name__ == '__main__':
    main()
