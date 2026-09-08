"""Deterministic synthetic dataset generator for CPU-training TIMING probes.

Refs #423, spec §11: the pilot training target is <=30 minutes for 10,000
regions. These rows are numerically valid (they pass trainer admission) but are
NOT evidence: no real capture, no quality meaning, never admitted to a corpus
or quality report. Resource measurements only.
"""
import argparse
import json
import pathlib
import random
import sys

MAX_ROWS = 10000
GROUPS = 50


def generate(count, seed=423):
    if not 1 <= count <= MAX_ROWS:
        raise ValueError('bound')
    rng = random.Random(seed)
    group_splits = {}
    rows = []
    for index in range(count):
        group = f'app-{index % GROUPS:02d}'
        if group not in group_splits:
            roll = rng.random()
            group_splits[group] = 'train' if roll < 0.6 else 'calibration' if roll < 0.8 else 'test'
        validity = [1.0 if i in (4, 5, 9) or rng.random() < 0.8 else 0.0 for i in range(16)]
        numeric = [
            (round(rng.uniform(-2, 2), 6) if i in (4, 5, 9) else round(rng.random(), 6))
            if validity[i]
            else 0.0
            for i in range(16)
        ]
        features = numeric + validity
        features += [round(rng.random(), 6) for _ in range(64)]
        rows.append({
            'id': f'row-{index:05d}',
            'group': group,
            'split': group_splits[group],
            'features': features,
            'labels': [1 if rng.random() < 0.5 else 0, None, None, None, None, None],
        })
    # Deterministic splits must contain every required class for head 0.
    for split in ['train', 'calibration', 'test']:
        if split in group_splits.values():
            labels = {r['labels'][0] for r in rows if r['split'] == split}
            if labels != {0, 1}:
                for row in (r for r in rows if r['split'] == split):
                    row['labels'][0] = 1 if (int(row['id'].split('-')[1]) % 2) == 0 else 0
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('output')
    parser.add_argument('--rows', type=int, default=MAX_ROWS)
    parser.add_argument('--seed', type=int, default=423)
    args = parser.parse_args()
    rows = generate(args.rows, args.seed)
    pathlib.Path(args.output).write_text(json.dumps(rows))


if __name__ == '__main__':
    sys.exit(main())
