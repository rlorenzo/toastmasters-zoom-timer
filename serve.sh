#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Serve the static app with no-cache headers so a plain reload always picks up
# edited JS/CSS/HTML. Python's stock http.server sends no cache headers, which
# lets browsers keep reusing stale ES modules (app.js / timer-core.js) even after
# a hard reload. The custom handler below forces a fresh fetch every time.
PORT="${1:-8000}"

exec python3 - "$PORT" <<'PY'
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


port = int(sys.argv[1])
print(f"Serving with no-cache headers on http://localhost:{port}")
# Bind to loopback only — this is a local dev server, no need to expose it to
# the whole network.
HTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
PY
