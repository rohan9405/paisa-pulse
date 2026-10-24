#!/usr/bin/env python3
"""One version source: package.json version + androidVersionCode. No publish side effects."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('bump', choices=['patch', 'minor', 'major'], nargs='?')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    path = ROOT / 'package.json'
    data = json.loads(path.read_text())
    assert re.fullmatch(r'\d+\.\d+\.\d+', data['version']), 'Use major.minor.patch'
    assert type(data['androidVersionCode']) is int and 0 < data['androidVersionCode'] <= 2100000000
    last_path = ROOT / 'android/last-version-code'
    last = int(last_path.read_text()) if last_path.exists() else 0
    if args.bump:
        major, minor, patch = map(int, data['version'].split('.'))
        data['version'] = {'patch': f'{major}.{minor}.{patch+1}', 'minor': f'{major}.{minor+1}.0', 'major': f'{major+1}.0.0'}[args.bump]
        data['androidVersionCode'] = max(last, data['androidVersionCode']) + 1
        path.write_text(json.dumps(data, indent=2) + '\n')
        lock_path = ROOT / 'package-lock.json'
        lock = json.loads(lock_path.read_text())
        lock['version'] = lock['packages']['']['version'] = data['version']
        lock_path.write_text(json.dumps(lock, indent=2) + '\n')
    assert data['androidVersionCode'] >= last, 'Build number would downgrade existing installations'
    lock = json.loads((ROOT / 'package-lock.json').read_text())
    assert lock['version'] == lock['packages']['']['version'] == data['version'], 'Lockfile version mismatch'
    manifest = (ROOT / 'android/AndroidManifest.xml').read_text()
    assert 'android:versionName' not in manifest and 'android:versionCode' not in manifest, 'Version must come from package.json'
    assert 'package="dev.paisapulse.app"' in manifest, 'Do not orphan existing installations'
    assert 'android:targetSdkVersion="36"' in manifest
    print(f"drip {data['version']} (build {data['androidVersionCode']}) — version checks passed")
    if not args.bump and not args.check:
        print('To bump: npm run release:bump -- patch|minor|major')

if __name__ == '__main__':
    main()
