#!/usr/bin/env python3
"""Build the Paisa Pulse Android app: static Next.js export inside a WebView shell.

Uses the Android SDK tools directly (aapt2, javac, d8, zipalign, apksigner); no
Gradle and no third-party Android libraries. Output: android/build/PaisaPulse.apk.

    python3 android/build.py               # rebuild web + APK
    python3 android/build.py --skip-web    # reuse the last web export

Updates must never cost the user their data, so the build refuses anything that
couldn't install over the existing app:
- the signing key must match the pinned certificate (android/signing-cert.sha256);
  a missing android/paisa.keystore is an error, not a cue to make a new one;
- versionCode can never go below the last build (android/last-version-code).
Keep a copy of android/paisa.keystore somewhere safe.
"""
import argparse
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "android"
OUT = SOURCE / "build"
WEB = ROOT / ".next-android"
KEY = SOURCE / "paisa.keystore"
PIN = SOURCE / "signing-cert.sha256"
LAST_CODE = SOURCE / "last-version-code"

# Optional machine-specific paths (git-ignored), e.g.
# {"build_tools": ".../build-tools/35.0.0", "platform": ".../platforms/android-35/android.jar", "java": ".../Contents/Home"}
LOCAL = SOURCE / "local.json"


def defaults() -> dict:
    local = json.loads(LOCAL.read_text()) if LOCAL.exists() else {}
    sdk = Path(os.environ.get("ANDROID_HOME", "~/Library/Android/sdk")).expanduser()
    return {
        "build_tools": os.environ.get("ANDROID_BUILD_TOOLS") or local.get("build_tools") or str(sdk / "build-tools/35.0.0"),
        "platform": os.environ.get("ANDROID_JAR") or local.get("platform") or str(sdk / "platforms/android-35/android.jar"),
        "java": os.environ.get("JAVA_HOME") or local.get("java") or "",
    }


def run(*args, env=None, cwd=None):
    subprocess.run([str(a) for a in args], check=True, env=env, cwd=cwd)


def main():
    parser = argparse.ArgumentParser()
    d = defaults()
    parser.add_argument("--build-tools", default=d["build_tools"])
    parser.add_argument("--platform", default=d["platform"])
    parser.add_argument("--java", default=d["java"], help="JDK home (17+)")
    parser.add_argument("--skip-web", action="store_true")
    parser.add_argument("--new-key", action="store_true", help="first build only: create a signing key and pin it")
    args = parser.parse_args()
    if not args.java:
        raise SystemExit("Set JAVA_HOME, pass --java, or add \"java\" to android/local.json.")
    tools, java = Path(args.build_tools), Path(args.java)
    env = {**os.environ, "JAVA_HOME": str(java), "PATH": f"{java}/bin:{os.environ['PATH']}"}
    check_update_safety(args.new_key)

    if not args.skip_web:
        shutil.rmtree(WEB, ignore_errors=True)
        run("npx", "next", "build", cwd=ROOT, env={**env, "NEXT_STATIC_EXPORT": "1", "NEXT_DIST_DIR": ".next-android"})
    if not (WEB / "index.html").exists():
        raise SystemExit("No web export at .next-android; run without --skip-web.")

    shutil.rmtree(OUT, ignore_errors=True)
    for part in ("classes", "generated", "dex", "resources"):
        (OUT / part).mkdir(parents=True)

    for res in sorted(p for p in (SOURCE / "res").rglob("*") if p.is_file()):
        run(tools / "aapt2", "compile", res, "-o", OUT / "resources")
    run(tools / "aapt2", "link", "-o", OUT / "unsigned.apk", "--manifest", SOURCE / "AndroidManifest.xml",
        "-I", args.platform, "--java", OUT / "generated", *sorted((OUT / "resources").glob("*.flat")))

    sources = sorted((SOURCE / "src").rglob("*.java")) + sorted((OUT / "generated").rglob("*.java"))
    run(java / "bin/javac", "--release", "8", "-Xlint:-options", "-classpath", args.platform, "-d", OUT / "classes", *sources)
    run(java / "bin/jar", "cf", OUT / "classes.jar", "-C", OUT / "classes", ".")
    run(tools / "d8", "--min-api", "26", "--lib", args.platform, "--output", OUT / "dex", OUT / "classes.jar", env=env)

    # Web files go straight into the zip: aapt2 would skip Next's "_next" folder (it ignores "_*" dirs).
    with zipfile.ZipFile(OUT / "unsigned.apk", "a", zipfile.ZIP_DEFLATED) as apk:
        for dex in sorted((OUT / "dex").glob("*.dex")):
            apk.write(dex, dex.name)
        for f in sorted(p for p in WEB.rglob("*") if p.is_file()):
            apk.write(f, "assets/web/" + f.relative_to(WEB).as_posix())

    run(tools / "zipalign", "-f", "4", OUT / "unsigned.apk", OUT / "aligned.apk")
    if args.new_key and not KEY.exists():
        run(java / "bin/keytool", "-genkeypair", "-keystore", KEY, "-storepass", "android", "-keypass", "android",
            "-alias", "paisa", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000", "-dname", "CN=Paisa Pulse Local")
        KEY.chmod(0o600)
    apk = OUT / "PaisaPulse.apk"
    run(tools / "apksigner", "sign", "--ks", KEY, "--ks-key-alias", "paisa", "--ks-pass", "pass:android",
        "--out", apk, OUT / "aligned.apk", env=env)
    certs = subprocess.run([str(tools / "apksigner"), "verify", "--print-certs", str(apk)], check=True, env=env, capture_output=True, text=True).stdout
    digest = next(l.split(":")[-1].strip() for l in certs.splitlines() if "certificate SHA-256 digest" in l)
    if not PIN.exists():
        PIN.write_text(digest + "\n")
    elif PIN.read_text().strip() != digest:
        apk.unlink()
        raise SystemExit(f"Signed with the wrong key ({digest}); expected {PIN.read_text().strip()}. This APK could not update the installed app.")
    LAST_CODE.write_text(str(version_code()) + "\n")
    print("Built and verified:", apk, f"(versionCode {version_code()}, key {digest[:12]}…)")


def version_code() -> int:
    return int(re.search(r'android:versionCode="(\d+)"', (SOURCE / "AndroidManifest.xml").read_text()).group(1))


def check_update_safety(new_key: bool):
    if not KEY.exists() and not new_key:
        raise SystemExit(
            "android/paisa.keystore is missing. Restore it from your backup: an APK signed with any other key can't "
            "update the installed app, and uninstalling to get around that deletes all of its data. "
            "Use --new-key only for the very first build."
        )
    if new_key and PIN.exists():
        raise SystemExit("A signing certificate is already pinned; refusing to create a new key.")
    last = int(LAST_CODE.read_text()) if LAST_CODE.exists() else 0
    if version_code() < last:
        raise SystemExit(f"versionCode {version_code()} is lower than the last build ({last}); Android won't install a downgrade over the app.")


if __name__ == "__main__":
    main()
