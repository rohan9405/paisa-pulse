#!/usr/bin/env python3
"""Verify the exact local artifacts before uploading them to Play."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('android_build', ROOT / 'android/build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

def capture(*args):
    return subprocess.run([str(a) for a in args], check=True, capture_output=True, text=True).stdout

def main():
    out = ROOT / 'android/build'
    release = json.loads((out / 'release.json').read_text())
    package = build.release_version()
    assert release['version'] == package['version'] and release['versionCode'] == package['androidVersionCode'], 'Rebuild after changing version'
    pin = (ROOT / 'android/signing-cert.sha256').read_text().strip().lower()
    assert release['signingCertificateSha256'] == pin
    for name, digest in release['files'].items():
        assert hashlib.sha256((out / name).read_bytes()).hexdigest() == digest, f'{name} changed after validation'
    paths = build.defaults()
    java = Path(paths['java']) / 'bin'
    # keytool reads only the public signing certificate from the signed bundle.
    cert = capture(java / 'keytool', '-printcert', '-jarfile', out / 'drip.aab')
    aab_pin = re.search(r'SHA256:\s*([0-9A-F:]+)', cert).group(1).replace(':', '').lower()
    assert aab_pin == pin, 'Bundle signer differs from installed-app identity'
    assert 'jar verified.' in capture(java / 'jarsigner', '-verify', out / 'drip.aab')
    import os
    apk = subprocess.run([str(Path(paths['build_tools']) / 'apksigner'), 'verify', '--print-certs', str(out / 'PaisaPulse.apk')], env={**os.environ, 'JAVA_HOME': paths['java']}, capture_output=True, text=True, check=True)
    assert pin in apk.stdout
    bundletool = os.environ.get('BUNDLETOOL_JAR', str(ROOT / 'android/.tools/bundletool.jar'))
    capture(java / 'java', '-jar', bundletool, 'validate', f'--bundle={out / "drip.aab"}')
    manifest = ET.fromstring(capture(java / 'java', '-jar', bundletool, 'dump', 'manifest', f'--bundle={out / "drip.aab"}', '--module=base'))
    ns = '{http://schemas.android.com/apk/res/android}'
    assert manifest.attrib['package'] == 'dev.paisapulse.app'
    assert manifest.attrib[ns+'versionName'] == package['version']
    assert int(manifest.attrib[ns+'versionCode']) == package['androidVersionCode']
    assert manifest.find('uses-sdk').attrib[ns+'targetSdkVersion'] == '36'
    assert manifest.find('uses-sdk').attrib[ns+'minSdkVersion'] == '26'
    app = manifest.find('application')
    assert app.attrib[ns+'allowBackup'] == 'false'
    assert app.attrib[ns+'usesCleartextTraffic'] == 'false'
    permissions = {p.attrib[ns+'name'] for p in manifest.findall('uses-permission')}
    assert permissions == {'android.permission.READ_SMS','android.permission.RECEIVE_SMS','android.permission.INTERNET','android.permission.USE_BIOMETRIC'}
    with zipfile.ZipFile(out / 'drip.aab') as archive:
        assert archive.read('base/assets/web/privacy.html') == (ROOT / 'public/privacy.html').read_bytes()
        assert archive.getinfo('base/dex/classes.dex').file_size > 0
        assert archive.getinfo('base/assets/web/index.html').file_size > 0
    print(f"Verified drip {package['version']} ({package['androidVersionCode']}): APK and AAB signatures, pinned certificate, hashes, API 36 manifest, permissions and bundled privacy policy.")

if __name__ == '__main__':
    main()
