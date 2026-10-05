from pathlib import Path
import tempfile
import unittest

from artifacts import source_revision


class SourceRevisionTests(unittest.TestCase):
    def test_fingerprint_changes_with_code_content_or_path(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'backend/app/example.py'
            source.parent.mkdir(parents=True)
            source.write_text('VALUE = 1\n', encoding='utf-8')
            original = source_revision(root)
            self.assertEqual(source_revision(root), original)
            source.write_text('VALUE = 2\n', encoding='utf-8')
            changed = source_revision(root)
            self.assertNotEqual(changed, original)
            source.rename(source.with_name('renamed.py'))
            self.assertNotEqual(source_revision(root), changed)

    def test_local_data_and_documentation_do_not_change_code_fingerprint(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'frontend/src/example.tsx'
            source.parent.mkdir(parents=True)
            source.write_text('export const value = 1;\n', encoding='utf-8')
            original = source_revision(root)
            (root / 'data').mkdir()
            (root / 'data/test.db').write_bytes(b'local data')
            (root / 'README.md').write_text('Documentação', encoding='utf-8')
            self.assertEqual(source_revision(root), original)


if __name__ == '__main__':
    unittest.main()
