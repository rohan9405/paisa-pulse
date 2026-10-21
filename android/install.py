#!/usr/bin/env python3
"""Private LAN install page for the Paisa Pulse APK, behind an unguessable URL.

    python3 android/install.py      # phone and Mac on the same Wi-Fi

Writes android/build/install-url.txt and, if the `qrcode` package is available,
android/build/install-qr.png. The APK is read on every request, so a rebuild is
served without restarting.
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import secrets
import socket

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "android/build"
APK = BUILD / "PaisaPulse.apk"
ICON = ROOT / "public/favicon.svg"


def lan_ip() -> str:
    # No packet is sent; this just asks the OS which interface routes outward.
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.connect(("192.168.0.1", 9))
        return s.getsockname()[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=lan_ip())
    parser.add_argument("--port", type=int, default=18778)
    args = parser.parse_args()
    key = secrets.token_urlsafe(18)
    page = f"""<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install Paisa Pulse</title><link rel="icon" href="/{key}/icon.svg">
<style>body{{background:#07070a;color:#e8e8ef;font:18px system-ui;max-width:550px;padding:30px;margin:auto;line-height:1.6}}
h1{{color:#c6ff3d;margin:12px 0 0}}a.dl{{display:block;padding:15px;border-radius:12px;text-align:center;background:#c6ff3d;color:#07070a;font-weight:700;text-decoration:none}}
li{{margin:12px 0}}.muted{{color:#8b8b9e;font-size:15px}}</style>
<img src="/{key}/icon.svg" width="72" height="72" alt=""><h1>Paisa Pulse</h1><p>How much can I spend today?</p>
<a class="dl" href="/{key}/PaisaPulse.apk">Download for Android</a>
<ol><li>Open the downloaded APK. If Android asks, allow this browser to install apps.</li>
<li>If Play Protect warns about an unknown app, choose <b>More details → Install anyway</b>.</li>
<li>Open Paisa Pulse and tap <b>Allow</b> for SMS. That's the only permission it asks for.</li>
<li>Set up your budget. Bank SMS from your tracking start date onwards come in automatically.</li></ol>
<p class="muted">SMS are read and parsed on the phone only; the app has no internet permission. Android 8+ · phone and Mac on the same Wi-Fi.</p>"""

    class Install(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            if self.path in (f"/{key}", f"/{key}/"):
                data, mime = page.encode(), "text/html; charset=utf-8"
            elif self.path == f"/{key}/PaisaPulse.apk" and APK.exists():
                data, mime = APK.read_bytes(), "application/vnd.android.package-archive"
            elif self.path == f"/{key}/icon.svg":
                data, mime = ICON.read_bytes(), "image/svg+xml"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.wfile.write(data)

    BUILD.mkdir(parents=True, exist_ok=True)
    url = f"http://{args.host}:{args.port}/{key}/"
    (BUILD / "install-url.txt").write_text(url)
    (BUILD / "install-url.txt").chmod(0o600)
    try:
        import qrcode

        qrcode.make(url, border=2).save(BUILD / "install-qr.png")
    except ImportError:
        print("qrcode not installed; no QR written", flush=True)
    print("Install page ready; private link in android/build/install-url.txt", flush=True)
    ThreadingHTTPServer((args.host, args.port), Install).serve_forever()


if __name__ == "__main__":
    main()
