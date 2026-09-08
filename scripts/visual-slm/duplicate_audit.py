"""Cross-split duplicate audit for compact-visual corpora (spec §9, refs #423).

Spec: "A reviewed duplicate audit must run across split boundaries." Families
(application/design-system groups) never split across train/calibration/test,
so an identical image hash appearing under two families is leakage and fails
the audit; a family observed in two splits is a split-integrity violation and
also fails. Within-family repeats (clean pairs reusing the same capture, for
example) are expected and only counted. Standard library only; this is a
dataset integrity check, never evidence admission or promotion authority.
"""
import argparse
import json
import pathlib
import sys

CORPUS_BOUND = 32 * 1024 * 1024


def collect(corpus_dir):
    root = pathlib.Path(corpus_dir)
    corpus = json.loads((root / 'corpus-v2.json').read_text())
    if not isinstance(corpus.get('cases'), list) or not corpus['cases']:
        raise ValueError('invalid-corpus')
    images = []  # (sha256, family, split, case_id)
    for entry in corpus['cases']:
        path = root / entry['manifest']
        if str(entry['manifest']).startswith('/') or '..' in str(entry['manifest']).split('/'):
            raise ValueError('unsafe-path')
        try:
            manifest = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError(f'invalid-manifest:{entry["manifest"]}:{error}') from error
        for reference in (manifest.get('before'), manifest.get('current')):
            if not isinstance(reference, dict) or not isinstance(reference.get('sha256'), str):
                raise ValueError(f'invalid-manifest:{entry["manifest"]}')
            images.append(
                (reference['sha256'], entry['family'], entry['split'], manifest.get('id', entry['manifest']))
            )
    return images


def audit(images):
    by_hash = {}
    for sha256, family, split, case_id in images:
        by_hash.setdefault(sha256, set()).add((family, split, case_id))
    cross_group = []
    within_family_repeats = 0
    for sha256, uses in by_hash.items():
        families = {use[0] for use in uses}
        if len(families) > 1:
            cross_group.append(
                {
                    'sha256': sha256,
                    'families': sorted(families),
                    'cases': sorted(use[2] for use in uses),
                }
            )
        elif len(uses) > 1:
            within_family_repeats += len(uses) - 1
    family_splits = {}
    for _, family, split, _ in images:
        family_splits.setdefault(family, set()).add(split)
    multi_split = sorted(f for f, splits in family_splits.items() if len(splits) > 1)
    return {
        'ok': not cross_group and not multi_split,
        'images': len(images),
        'uniqueHashes': len(by_hash),
        'crossGroupDuplicates': cross_group,
        'familyInMultipleSplits': multi_split,
        'withinFamilyRepeats': within_family_repeats,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('corpus_dir')
    args = parser.parse_args()
    report = audit(collect(args.corpus_dir))
    print(json.dumps(report, indent=2))
    if not report['ok']:
        sys.exit(1)


if __name__ == '__main__':
    main()
