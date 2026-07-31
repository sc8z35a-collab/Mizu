from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os
import socket
import webbrowser

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT_CANDIDATES = range(4173, 4193)


def choose_port() -> int:
    for port in PORT_CANDIDATES:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind((HOST, port))
            except OSError:
                continue
            return port
    raise RuntimeError("使用可能なローカルポートが見つかりませんでした。")


os.chdir(ROOT)
port = choose_port()
server = ThreadingHTTPServer((HOST, port), SimpleHTTPRequestHandler)
url = f"http://{HOST}:{port}"
print(f"MIZUNE 修正版: {url}")
print("終了するには Ctrl+C を押してください。")
try:
    webbrowser.open(url)
except Exception:
    pass

try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\nMIZUNEを終了します。")
finally:
    server.server_close()
