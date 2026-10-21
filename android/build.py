#!/usr/bin/env python3
"""Build the Paisa Pulse Android app: static Next.js export inside a WebView shell.

Uses the Android SDK tools directly (aapt2, javac, d8, zipalign, apksigner); no
Gradle and no third-party Android libraries. Output: android/build/PaisaPulse.apk.

    python3 android/build.py               # rebuild web + APK
    python3 android/build.py --skip-web    # reuse the last web export

Keep android/paisa.keystore: an update only installs over the phone's copy if
it's signed with the same key.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "android"
OUT = SOURCE / "build"
WEB = ROOT / ".next-android"
KEY = SOURCE / "paisa.keystore"

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
    args = parser.parse_args()
    if not args.java:
        raise SystemExit("Set JAVA_HOME, pass --java, or add \"java\" to android/local.json.")
    tools, java = Path(args.build_tools), Path(args.java)
    env = {**os.environ, "JAVA_HOME": str(java), "PATH": f"{java}/bin:{os.environ['PATH']}"}

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
    if not KEY.exists():
        run(java / "bin/keytool", "-genkeypair", "-keystore", KEY, "-storepass", "android", "-keypass", "android",
            "-alias", "paisa", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000", "-dname", "CN=Paisa Pulse Local")
        KEY.chmod(0o600)
    apk = OUT / "PaisaPulse.apk"
    run(tools / "apksigner", "sign", "--ks", KEY, "--ks-key-alias", "paisa", "--ks-pass", "pass:android",
        "--out", apk, OUT / "aligned.apk", env=env)
    run(tools / "apksigner", "verify", apk, env=env)
    print("Built and verified:", apk)


if __name__ == "__main__":
    main()
