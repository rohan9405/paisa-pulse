import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('android_build', ROOT / 'android/build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

class ReleaseSafety(unittest.TestCase):
    def test_missing_existing_key_never_creates_replacement(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(build, 'KEY', Path(tmp) / 'missing.keystore'):
                with self.assertRaisesRegex(SystemExit, 'Restore it'):
                    build.check_update_safety(False)

    def test_downgrade_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            key = Path(tmp) / 'key'; key.touch()
            last = Path(tmp) / 'last'; last.write_text('13')
            with patch.object(build, 'KEY', key), patch.object(build, 'LAST_CODE', last), patch.object(build, 'version_code', return_value=12):
                with self.assertRaisesRegex(SystemExit, 'lower than'):
                    build.check_update_safety(False)

    def test_pinned_identity_refuses_new_key(self):
        with self.assertRaisesRegex(SystemExit, 'already pinned'):
            build.check_update_safety(True)

    def test_invalid_play_build_number_is_refused(self):
        for code in [True, 0, -1, 2100000001, '12']:
            with self.subTest(code=code), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / 'package.json').write_text(json.dumps({'version':'0.8.0','androidVersionCode':code}))
                with patch.object(build, 'ROOT', root):
                    with self.assertRaises(SystemExit):build.release_version()

    def test_stale_web_export_detects_source_and_config_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for folder in ['src','public']:(root / folder).mkdir()
            for name in ['package.json','package-lock.json','next.config.mjs','tailwind.config.ts','postcss.config.mjs']:
                (root / name).write_text('{}')
            source = root / 'src/example.ts';source.write_text('original')
            with patch.object(build,'ROOT',root), patch.object(build,'config_url',return_value='https://config.example/config.json'):
                original = build.web_fingerprint()
                source.write_text('changed')
                self.assertNotEqual(original, build.web_fingerprint())
                source.write_text('original')
                self.assertEqual(original, build.web_fingerprint())
                with patch.object(build,'config_url',return_value=''):
                    self.assertNotEqual(original,build.web_fingerprint())

if __name__ == '__main__':unittest.main()
