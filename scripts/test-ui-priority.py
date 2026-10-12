"""Exercise the actual compiled simulator components using only loopback data."""
import os
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
build = root / "esphome/.esphome/build/energydeck-simulator"
# Keep new polling paths from accidentally reintroducing foreground sockets.
for package in (root / "esphome/packages").glob("*.yaml"):
    text = package.read_text()
    assert "http_request.get:" not in text and "http_request.post:" not in text, package
objects = [str(p) for p in (build / ".pioenvs/energydeck-simulator/src").rglob("*.o")
           if p.name != "main.o" and p.as_posix().split("/src/")[-1] != "esphome/components/host/core.o"]
libraries = [str(p) for p in (build / ".pioenvs/energydeck-simulator").glob("lib*/lib*.a")]
if not objects or not libraries:
    raise SystemExit("Build the simulator first.")
class Handler(BaseHTTPRequestHandler):
    posts = 0
    failures = []
    image = b""
    protocol_version = "HTTP/1.1"
    def log_message(self, *_):
        pass
    def do_GET(self):
        try:
            if self.path == "/slow":
                assert self.headers["Authorization"] == "Bearer synthetic-test-token"
                time.sleep(0.45)
                self.reply(b"complete")
            elif self.path.startswith("/image"):
                if self.path == "/image-slow": time.sleep(0.3)
                if self.headers.get("If-None-Match") == "test-image": self.reply(b"", 304)
                else: self.reply(Handler.image, headers=[("Content-Type", "image/png"), ("ETag", "test-image")])
            elif self.path == "/chunked":
                self.send_response(200); self.send_header("Transfer-Encoding", "chunked"); self.send_header("ETag", "test"); self.end_headers()
                for chunk in [b"first", b"second"]:
                    self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n"); self.wfile.flush(); time.sleep(0.03)
                self.wfile.write(b"0\r\n\r\n"); self.wfile.flush()
            elif self.path == "/oversized":
                self.reply(b"x" * 100)
            elif self.path == "/truncated":
                self.send_response(200); self.send_header("Content-Length", "12"); self.send_header("Connection", "close"); self.end_headers(); self.wfile.write(b"short"); self.close_connection = True
            elif self.path == "/stall":
                time.sleep(0.3); self.reply(b"late")
            elif self.path == "/redirect":
                self.reply(b"", 302, [("Location", "/must-not-follow")])
            elif self.path == "/must-not-follow":
                Handler.failures.append("Redirect followed"); self.reply(b"", 500)
            elif self.path == "/count":
                self.reply(str(Handler.posts).encode())
            else:
                self.reply(b"", 404)
        except (BrokenPipeError, ConnectionResetError):
            pass
    def do_POST(self):
        assert self.path == "/post"
        assert self.rfile.read(int(self.headers["Content-Length"])) == b"{}"
        Handler.posts += 1
        self.reply(b"{}")
    def reply(self, body, status=200, headers=()):
        self.send_response(status); self.send_header("Content-Length", str(len(body)))
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers(); self.wfile.write(body); self.wfile.flush()

with tempfile.TemporaryDirectory(prefix="energydeck-ui-priority-") as temp:
    assets = Path(temp)
    image = Image.new("RGB", (64, 32), (255, 0, 0))
    image.save(assets / "image.png"); image.save(assets / "image.jpg", quality=95)
    image.save(assets / "progressive.jpg", progressive=True)
    Handler.image = (assets / "image.png").read_bytes()
    (assets / "truncated.png").write_bytes((assets / "image.png").read_bytes()[:-12])
    (assets / "truncated.jpg").write_bytes((assets / "image.jpg").read_bytes()[:-2])
    (assets / "invalid.png").write_bytes(b"invalid image")
    binary = assets / "test"
    includes = ["-I" + str(build / "src")]
    for dependency in ["lvgl", "pngle/src", "JPEGDEC/src", "ArduinoJson/src"]:
        includes.append("-I" + str(build / ".piolibdeps/energydeck-simulator" / dependency))
    subprocess.run(["c++", "-g", "-std=c++20", "-DUSE_HOST", "-DLV_CONF_H=1", "-DLV_KCONFIG_IGNORE", "-include", str(build / "src/lv_conf.h"),
                    *includes, str(root / "scripts/test-ui-priority.cpp"), *objects, *libraries,
                    "-L/opt/homebrew/lib", "-L/opt/homebrew/opt/openssl/lib", "-lSDL2", "-lssl", "-lcrypto",
                    "-framework", "Cocoa", "-framework", "CoreFoundation", "-framework", "Security",
                    "-o", str(binary)], check=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        subprocess.run([str(binary), f"http://127.0.0.1:{server.server_port}", str(assets)], check=True, timeout=20, env={**os.environ, "SDL_VIDEODRIVER": "dummy"})
        if preview := os.environ.get("ENERGYDECK_UI_SNAPSHOT"):
            Image.open(assets / "radionl-render.ppm").save(preview)
    finally:
        server.shutdown(); server.server_close()
    assert not Handler.failures, Handler.failures
