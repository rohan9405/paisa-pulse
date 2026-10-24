#!/usr/bin/env python3
"""Package only verified public release artifacts, never keys or machine settings."""
from pathlib import Path
import json
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
subprocess.run([sys.executable, str(ROOT / 'scripts/verify-release.py')], check=True)
release = json.loads((ROOT / 'android/build/release.json').read_text())
out = ROOT / 'android/build' / f"drip-{release['version']}-{release['versionCode']}-play-store.zip"
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in ['drip.aab', 'PaisaPulse.apk', 'release.json']:
        archive.write(ROOT / 'android/build' / name, 'build/' + name)
    archive.write(ROOT / 'docs/PLAY_STORE.md', 'submission/PLAY_STORE.md')
    for path in sorted((ROOT / 'docs/play-store').rglob('*')):
        if path.is_file(): archive.write(path, 'submission/' + str(path.relative_to(ROOT / 'docs/play-store')))
print(out)
