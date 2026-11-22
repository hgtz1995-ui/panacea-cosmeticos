#!/usr/bin/env python3
"""Servidor local para Panacea Cosméticos (Tienda + Backoffice /admin.html).
Guarda los cambios del Backoffice directo en data.js y crea respaldos automáticos.
Uso: python3 server.py [puerto]
"""
import base64
import json
import os
import re
import shutil
import sys
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_JS = ROOT / "data.js"
BACKUPS_DIR = ROOT / ".backups"
UPLOADS_DIR = ROOT / "assets" / "uploads"
ADMIN_PIN = os.environ.get("ADMIN_PIN", "")


def read_catalog():
    if not DATA_JS.exists():
        return None
    text = DATA_JS.read_text(encoding="utf-8")
    m = re.search(r"window\.PANACEA_DATA\s*=\s*(\{.*\})\s*;?\s*$", text, re.S)
    if not m:
        return None
    return json.loads(m.group(1))


def write_catalog(data):
    BACKUPS_DIR.mkdir(exist_ok=True)
    if DATA_JS.exists():
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        shutil.copy2(DATA_JS, BACKUPS_DIR / f"data-{stamp}.js")
        # Conservar los últimos 25 respaldos
        backups = sorted(BACKUPS_DIR.glob("data-*.js"))
        for old in backups[:-25]:
            old.unlink(missing_ok=True)

    payload = (
        "// Catálogo actualizado desde Mi Tienda Panacea (Backoffice)\n"
        "window.PANACEA_DATA = "
        + json.dumps(data, ensure_ascii=False, indent=2)
        + ";\n"
    )
    tmp = DATA_JS.with_suffix(".js.tmp")
    tmp.write_text(payload, encoding="utf-8")
    tmp.replace(DATA_JS)


class PanaceaHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, obj, status=200):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def do_GET(self):
        if self.path.split("?")[0] == "/api/catalog":
            return self.send_json({
                "catalog": read_catalog(),
                "requiresPin": bool(ADMIN_PIN),
                "backend": "Servidor local Panacea (guarda directo en data.js + respaldos automáticos)",
            })
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?")[0]
        body = self.read_json_body()
        if path == "/api/catalog" and body.get("action") == "verifyPin":
            if not ADMIN_PIN or str(body.get("pin", "")) == ADMIN_PIN:
                return self.send_json({"ok": True})
            return self.send_json({"ok": False}, 401)

        if path == "/api/upload":
            if ADMIN_PIN and self.headers.get("X-Admin-Pin", "") != ADMIN_PIN:
                return self.send_json({"error": "No autorizado"}, 401)
            data_url = body.get("dataUrl", "")
            m = re.match(r"^data:image/(\w+);base64,(.+)$", data_url, re.S)
            if not m:
                return self.send_json({"error": "Imagen inválida"}, 400)
            ext = "jpg" if m.group(1).lower() in ("jpeg", "jpg") else m.group(1).lower()
            UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
            base = re.sub(r"[^a-z0-9-]+", "-", Path(body.get("filename", "foto")).stem.lower()).strip("-") or "foto"
            fname = f"{base}-{datetime.now().strftime('%Y%m%d%H%M%S')}.{ext}"
            (UPLOADS_DIR / fname).write_bytes(base64.b64decode(m.group(2)))
            return self.send_json({"url": f"assets/uploads/{fname}"})

        return self.send_json({"error": "No encontrado"}, 404)

    def do_PUT(self):
        if self.path.split("?")[0] != "/api/catalog":
            return self.send_json({"error": "No encontrado"}, 404)
        if ADMIN_PIN and self.headers.get("X-Admin-Pin", "") != ADMIN_PIN:
            return self.send_json({"error": "No autorizado"}, 401)
        data = self.read_json_body()
        if not isinstance(data, dict) or not isinstance(data.get("products"), list):
            return self.send_json({"error": "Catálogo inválido"}, 400)
        write_catalog(data)
        return self.send_json({"ok": True})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    srv = ThreadingHTTPServer(("127.0.0.1", port), PanaceaHandler)
    print(f"Panacea lista en:")
    print(f"  Tienda:     http://localhost:{port}/")
    print(f"  Backoffice: http://localhost:{port}/admin.html")
    srv.serve_forever()
