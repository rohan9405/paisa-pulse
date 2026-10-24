#!/usr/bin/env python3
"""Build the drip Android app: static Next.js export inside a WebView shell.

Uses the Android SDK tools directly (aapt2, javac, d8, zipalign, apksigner); no
Gradle and no third-party Android libraries. Outputs: android/build/PaisaPulse.apk
and, with --bundle, a signed and validated drip.aab for Google Play.

    python3 android/build.py               # rebuild web + APK
    python3 android/build.py --skip-web    # reuse the last web export

Updates must never cost the user their data, so the build refuses anything that
couldn't install over the existing app:
- the signing key must match the pinned certificate (android/signing-cert.sha256);
  a missing ~/.drip-private/paisa.keystore is an error, not a cue to make a new one;
- versionCode can never go below the last build (android/last-version-code).
The APK signing key is ~/.drip-private/paisa.keystore (outside the repo). Keep a
backup of it somewhere safe.
"""
import argparse
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import zipfile
import hashlib

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "android"
OUT = SOURCE / "build"
WEB = ROOT / ".next-android"
# Secrets live outside the repo (never committed): ~/.drip-private, or $DRIP_PRIVATE_DIR.
PRIVATE = Path(os.environ.get("DRIP_PRIVATE_DIR", "~/.drip-private")).expanduser()
KEY = PRIVATE / "paisa.keystore"
PIN = SOURCE / "signing-cert.sha256"
LAST_CODE = SOURCE / "last-version-code"

# Optional machine-specific paths (git-ignored), e.g.
# {"build_tools": ".../build-tools/35.0.0", "platform": ".../platforms/android-36/android.jar", "java": ".../Contents/Home"}
LOCAL = SOURCE / "local.json"


def defaults() -> dict:
    local = json.loads(LOCAL.read_text()) if LOCAL.exists() else {}
    sdk = Path(os.environ.get("ANDROID_HOME", "~/Library/Android/sdk")).expanduser()
    project_platform = SOURCE / ".sdk/platforms/android-36/android.jar"
    return {
        "build_tools": os.environ.get("ANDROID_BUILD_TOOLS") or local.get("build_tools") or str(sdk / "build-tools/35.0.0"),
        "platform": os.environ.get("ANDROID_JAR") or (str(project_platform) if project_platform.exists() else local.get("platform") or str(sdk / "platforms/android-36/android.jar")),
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
    parser.add_argument("--bundle", action="store_true", help="also build a signed Play App Bundle")
    parser.add_argument("--bundletool", default=os.environ.get("BUNDLETOOL_JAR", str(SOURCE / ".tools/bundletool.jar")))
    parser.add_argument("--new-key", action="store_true", help="first build only: create a signing key and pin it")
    args = parser.parse_args()
    if not args.java:
        raise SystemExit("Set JAVA_HOME, pass --java, or add \"java\" to android/local.json.")
    tools, java = Path(args.build_tools), Path(args.java)
    env = {**os.environ, "JAVA_HOME": str(java), "PATH": f"{java}/bin:{os.environ['PATH']}"}
    check_update_safety(args.new_key)
    if args.bundle and not Path(args.bundletool).is_file():
        raise SystemExit("Missing bundletool; see docs/PLAY_STORE.md for setup.")
    if not Path(args.platform).is_file():
        raise SystemExit("Android API 36 SDK missing; install platforms;android-36 or set ANDROID_JAR.")
    properties = Path(args.platform).parent / "source.properties"
    api = re.search(r"AndroidVersion.ApiLevel\s*=\s*(\d+)", properties.read_text()) if properties.exists() else None
    if not api or int(api.group(1)) < 36:
        raise SystemExit("Compile against Android API 36 or newer; the old API 35 local.json path is not Play-ready.")

    if not args.skip_web:
        shutil.rmtree(WEB, ignore_errors=True)
        version_name = release_version()["version"]
        run("npx", "next", "build", cwd=ROOT, env={**env, "NEXT_STATIC_EXPORT": "1", "NEXT_DIST_DIR": ".next-android", "NEXT_PUBLIC_CONFIG_URL": config_url(), "NEXT_PUBLIC_APP_VERSION": version_name})
        (WEB / ".drip-build-fingerprint").write_text(web_fingerprint())
    if not (WEB / "index.html").exists():
        raise SystemExit("No web export at .next-android; run without --skip-web.")
    if args.skip_web and (not (WEB / ".drip-build-fingerprint").exists() or (WEB / ".drip-build-fingerprint").read_text() != web_fingerprint()):
        raise SystemExit("Web sources, version or config changed; rebuild without --skip-web.")

    shutil.rmtree(OUT, ignore_errors=True)
    for part in ("classes", "generated", "dex", "resources"):
        (OUT / part).mkdir(parents=True)

    for res in sorted(p for p in (SOURCE / "res").rglob("*") if p.is_file()):
        run(tools / "aapt2", "compile", res, "-o", OUT / "resources")
    run(tools / "aapt2", "link", "-o", OUT / "unsigned.apk", "--manifest", SOURCE / "AndroidManifest.xml",
        "-I", args.platform, "--version-code", version_code(), "--version-name", release_version()["version"],
        "--java", OUT / "generated", *sorted((OUT / "resources").glob("*.flat")))

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
        # The one outside URL the WebView may fetch (remote config); everything else stays blocked.
        apk.writestr("assets/config-url.txt", config_url())

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
    if args.bundle:
        build_bundle(tools, java, args, env)
    LAST_CODE.write_text(str(version_code()) + "\n")
    metadata = {"version": release_version()["version"], "versionCode": version_code(),
                "applicationId": "dev.paisapulse.app", "signingCertificateSha256": digest,
                "files": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in [apk, OUT / "drip.aab"] if p.exists()}}
    (OUT / "release.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print("Built and verified:", apk, f"(versionCode {version_code()}, key {digest[:12]}…)")


def config_url() -> str:
    """Remote config endpoint (backend/), from $DRIP_CONFIG_URL or android/local.json "config_url". Empty = off."""
    local = json.loads(LOCAL.read_text()) if LOCAL.exists() else {}
    url = os.environ.get("DRIP_CONFIG_URL") or local.get("config_url") or ""
    if url and not url.startswith("https://"):
        raise SystemExit("config_url must be https://")
    return url


def release_version() -> dict:
    data = json.loads((ROOT / "package.json").read_text())
    if not re.fullmatch(r"\d+\.\d+\.\d+", data["version"]):
        raise SystemExit("package.json version must be major.minor.patch")
    if type(data.get("androidVersionCode")) is not int or not 0 < data["androidVersionCode"] <= 2100000000:
        raise SystemExit("package.json androidVersionCode must be a positive Play-compatible integer")
    return data


def web_fingerprint() -> str:
    digest = hashlib.sha256(config_url().encode())
    paths = [ROOT / name for name in ("package.json", "package-lock.json", "next.config.mjs", "tailwind.config.ts", "postcss.config.mjs")]
    paths += [p for folder in ("src", "public") for p in (ROOT / folder).rglob("*") if p.is_file()]
    for path in sorted(paths):
        digest.update(str(path.relative_to(ROOT)).encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def version_code() -> int:
    return release_version()["androidVersionCode"]


def build_bundle(tools, java, args, env):
    """Use Google's bundletool with an AAPT2 proto resource module, retaining the APK build."""
    proto = OUT / "proto.apk"
    run(tools / "aapt2", "convert", "--output-format", "proto", "-o", proto, OUT / "unsigned.apk")
    module = OUT / "base.zip"
    with zipfile.ZipFile(proto) as src, zipfile.ZipFile(module, "w", zipfile.ZIP_DEFLATED) as dst:
        for name in src.namelist():
            if name.endswith("/") or name.startswith("META-INF/"): continue
            target = "manifest/AndroidManifest.xml" if name == "AndroidManifest.xml" else "dex/" + name if re.fullmatch(r"classes\d*\.dex", name) else name
            dst.writestr(target, src.read(name))
    bundle = OUT / "drip.aab"
    run(java / "bin/java", "-jar", args.bundletool, "build-bundle", f"--modules={module}", f"--output={bundle}", env=env)
    run(java / "bin/jarsigner", "-keystore", KEY, "-storepass", "android", bundle, "paisa", env=env)
    verification = subprocess.run([str(java / "bin/jarsigner"), "-verify", str(bundle)], check=True, capture_output=True, text=True, env=env)
    if "jar verified." not in verification.stdout:
        raise SystemExit("App Bundle signature verification failed")
    run(java / "bin/java", "-jar", args.bundletool, "validate", f"--bundle={bundle}", env=env)
    print("Signed and validated Play bundle:", bundle)


def check_update_safety(new_key: bool):
    if not KEY.exists() and not new_key:
        raise SystemExit(
            "~/.drip-private/paisa.keystore is missing. Restore it from your backup: an APK signed with any other key can't "
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
