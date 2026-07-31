from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os, webbrowser

ROOT = Path(__file__).resolve().parent
PORT = 4173
os.chdir(ROOT)
url = f"http://127.0.0.1:{PORT}"
print(f"MIZUNE: {url}")
print("終了するには Ctrl+C を押してください。")
try:
    webbrowser.open(url)
except Exception:
    pass
ThreadingHTTPServer(("127.0.0.1", PORT), SimpleHTTPRequestHandler).serve_forever()
