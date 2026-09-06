"""Feature-lane ablation over a validated compact-visual dataset.

Diagnostic companion to train.py for failure analysis (refs #423): masks feature
lanes so experiments can attribute model behaviour to a lane without re-capture.
Variants keep exactly the listed indices and zero the rest; zeroing a numeric
value together with its validity bit is the documented missingness encoding, so
masked rows still satisfy trainer validation. Standard library only; no provider
calls. This is a developer diagnostic, not evidence admission or promotion
authority.
"""
import importlib.util
import json
import pathlib
import sys

_spec = importlib.util.spec_from_file_location('visual_train', pathlib.Path(__file__).with_name('train.py'))
train = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(train)

# geometry lane = numeric measurements + validity bits; image lane = 4x4 cells.
# Dropping a numeric measurement must also drop its validity bit (spec 8.1:
# zero-with-validity-one is a real measurement, not missingness).
VARIANTS = {
    'geometry': set(range(0, 32)),
    'image': set(range(32, 96)),
    'clip-only': {9, 25},
    'current-geometry': set(range(4, 16)) | set(range(20, 32)),
}


def ablate_rows(rows, variant):
    if variant not in VARIANTS:
        raise ValueError('unknown-variant')
    train.validate_rows(rows)
    keep = VARIANTS[variant]
    masked = []
    for row in rows:
        features = [value if index in keep else 0.0 for index, value in enumerate(row['features'])]
        masked.append({**row, 'features': features})
    train.validate_rows(masked)
    return masked


def main():
    if len(sys.argv) != 4:
        raise SystemExit('usage: ablate.py DATASET VARIANT OUTPUT')
    source, variant, output = pathlib.Path(sys.argv[1]), sys.argv[2], pathlib.Path(sys.argv[3])
    if source.stat().st_size > 32 * 1024 * 1024:
        raise ValueError('dataset-bound')
    rows = ablate_rows(json.loads(source.read_text()), variant)
    with output.open('x') as handle:
        json.dump(rows, handle)


if __name__ == '__main__':
    main()
