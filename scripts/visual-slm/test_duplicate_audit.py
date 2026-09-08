import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('visual_dupes', pathlib.Path(__file__).with_name('duplicate_audit.py'))
dupes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dupes)


def write_corpus(directory: pathlib.Path, cases):
    """cases: list of (family, split, case_id, before_sha, current_sha)."""
    entries = []
    for family, split, case_id, before, current in cases:
        manifest = {
            'version': 1, 'id': case_id, 'group': family, 'revision': 'a' * 40, 'consent': True,
            'context': {'width': 800, 'height': 600, 'dpr': 1, 'profile': 'p', 'state': 's'},
            'before': {'path': f'{case_id}-before.png', 'sha256': before},
            'current': {'path': f'{case_id}-current.png', 'sha256': current},
            'beforePrivacy': {'path': 'bp.json', 'sha256': '0' * 64},
            'currentPrivacy': {'path': 'cp.json', 'sha256': '0' * 64},
            'scene': {'path': 's.json', 'sha256': '0' * 64},
            'timeline': {'path': 't.json', 'sha256': '0' * 64},
            'timelineProvenance': {'path': 'tp.json', 'sha256': '0' * 64},
        }
        (directory / f'{case_id}.json').write_text(json.dumps(manifest))
        entries.append({'manifest': f'{case_id}.json', 'family': family, 'split': split})
    (directory / 'corpus-v2.json').write_text(json.dumps({'version': 1, 'cases': entries}))


class DuplicateAudit(unittest.TestCase):
    def test_flags_an_image_hash_shared_across_families_as_leakage(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = pathlib.Path(tmp)
            write_corpus(d, [
                ('app-a', 'train', 'a1', 'f' * 64, '1' * 64),
                ('app-b', 'test', 'b1', 'f' * 64, '2' * 64),
            ])
            report = dupes.audit(dupes.collect(d))
            self.assertFalse(report['ok'])
            self.assertEqual(len(report['crossGroupDuplicates']), 1)
            self.assertEqual(report['crossGroupDuplicates'][0]['sha256'], 'f' * 64)

    def test_allows_within_family_repeats_and_counts_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = pathlib.Path(tmp)
            write_corpus(d, [
                ('app-a', 'train', 'a1', 'f' * 64, '1' * 64),
                ('app-a', 'train', 'a2', 'f' * 64, '1' * 64),
                ('app-b', 'test', 'b1', 'e' * 64, '2' * 64),
            ])
            report = dupes.audit(dupes.collect(d))
            self.assertTrue(report['ok'])
            self.assertEqual(report['crossGroupDuplicates'], [])
            self.assertGreaterEqual(report['withinFamilyRepeats'], 2)

    def test_flags_a_family_present_in_two_splits(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = pathlib.Path(tmp)
            write_corpus(d, [
                ('app-a', 'train', 'a1', 'f' * 64, '1' * 64),
                ('app-a', 'test', 'a2', 'e' * 64, '2' * 64),
            ])
            report = dupes.audit(dupes.collect(d))
            self.assertFalse(report['ok'])
            self.assertEqual(report['familyInMultipleSplits'], ['app-a'])

    def test_rejects_missing_or_malformed_manifests_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = pathlib.Path(tmp)
            write_corpus(d, [('app-a', 'train', 'a1', 'f' * 64, '1' * 64)])
            (d / 'a1.json').unlink()
            with self.assertRaises(ValueError):
                dupes.collect(d)
            (d / 'a1.json').write_text('{broken')
            with self.assertRaises(ValueError):
                dupes.collect(d)


if __name__ == '__main__':
    unittest.main()
