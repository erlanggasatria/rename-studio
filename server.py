"""Local-only HTTP application, Python standard library, no installation needed."""
import argparse
import json
import mimetypes
import os
import secrets
import threading
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from rename_core import Engine, RenameError, make_plan, scan

ROOT = Path(__file__).resolve().parent


class App:
    def __init__(self, runtime=None):
        self.token = secrets.token_urlsafe(32)
        self.engine = Engine(runtime or ROOT / '.runtime')
        self.folder = None
        self.files = []
        self.plans = {}
        self.lock = threading.RLock()

    def load(self, folder):
        self.folder, self.files = scan(folder)
        self.plans.clear()
        return dict(folder=str(self.folder), name=self.folder.name or str(self.folder), files=self.files)

    def route(self, path, data):
        with self.lock:
            if path == '/api/status':
                return dict(ok=True, version='1.0.0', undo=self.engine.last_batch())
            if path == '/api/pick-folder':
                import tkinter as tk
                from tkinter import filedialog
                root = tk.Tk()
                root.withdraw()
                root.attributes('-topmost', True)
                try:
                    folder = filedialog.askdirectory(parent=root, title='Rename Studio — pilih folder file')
                finally:
                    root.destroy()
                return self.load(folder) if folder else dict(cancelled=True)
            if path == '/api/folder':
                folder = data.get('path', '')
                if not isinstance(folder, str) or not folder.strip():
                    raise RenameError('Masukkan lokasi folder.')
                return self.load(folder.strip())
            if path == '/api/preview':
                if self.folder is None:
                    raise RenameError('Pilih folder terlebih dahulu.')
                plan, width = make_plan(self.folder, self.files, data.get('selected'), data.get('prefix'), data.get('start', 1), data.get('digits', 'auto'), data.get('order', 'name'))
                ticket = uuid.uuid4().hex
                self.plans = {ticket: dict(folder=self.folder, plan=plan)}
                return dict(ticket=ticket, plan=plan, digits=width, changed=sum(item['source'] != item['target'] for item in plan))
            if path == '/api/apply':
                batch = self.plans.pop(data.get('ticket', ''), None)
                if batch is None:
                    raise RenameError('Pratinjau kedaluwarsa. Buat pratinjau lagi.')
                count = self.engine.execute(batch['folder'], batch['plan'])
                result = self.load(batch['folder'])
                return dict(**result, count=count, undo=self.engine.last_batch())
            if path == '/api/undo':
                last = self.engine.last_batch()
                count = self.engine.undo()
                result = self.load(last['folder'])
                return dict(**result, count=count, undo=self.engine.last_batch())
            raise RenameError('Rute tidak ditemukan.')


class Handler(BaseHTTPRequestHandler):
    server_version = 'RenameStudio/1.0'

    def log_message(self, *_args):
        # Do not log filenames, paths, headers, or request bodies.
        pass

    def send(self, status, content, content_type='application/json; charset=utf-8'):
        if not isinstance(content, bytes):
            content = json.dumps(content, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        self.end_headers()
        self.wfile.write(content)

    def allowed_host(self):
        return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')

    def api(self, data):
        origin = self.headers.get('Origin')
        allowed = (f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}')
        token = self.headers.get('X-Rename-Token', '')
        if not self.allowed_host() or (origin is not None and origin not in allowed) or not secrets.compare_digest(token, self.server.app.token):
            self.send(403, dict(error='Akses ditolak. Buka aplikasi dari alamat lokal yang dicetak server.'))
            return
        try:
            self.send(200, self.server.app.route(urlsplit(self.path).path, data))
        except (RenameError, OSError, TypeError, KeyError) as error:
            self.send(400, dict(error=str(error)))
        except Exception:
            self.send(500, dict(error='Proses gagal. Periksa izin folder atau coba buka folder melalui kolom lokasi.'))

    def do_GET(self):
        if not self.allowed_host():
            self.send(403, dict(error='Host tidak diizinkan.'))
            return
        path = urlsplit(self.path).path
        if path == '/api/status':
            return self.api({})
        assets = {'/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/icon.svg': 'icon.svg'}
        name = assets.get(path)
        if name is None:
            self.send(404, dict(error='Tidak ditemukan.'))
            return
        content = (ROOT / 'web' / name).read_bytes()
        if name == 'index.html':
            content = content.replace(b'__RENAME_TOKEN__', self.server.app.token.encode())
        mime = mimetypes.guess_type(name)[0] or 'application/octet-stream'
        self.send(200, content, mime + ('; charset=utf-8' if name.endswith(('.html', '.css', '.js')) else ''))

    def do_POST(self):
        if urlsplit(self.path).path not in ('/api/pick-folder', '/api/folder', '/api/preview', '/api/apply', '/api/undo'):
            return self.send(404, dict(error='Tidak ditemukan.'))
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 <= length <= 8_000_000:
                raise ValueError()
            data = json.loads(self.rfile.read(length) or b'{}')
            if not isinstance(data, dict):
                raise ValueError()
        except (ValueError, UnicodeDecodeError):
            return self.send(400, dict(error='Data permintaan tidak valid.'))
        self.api(data)


def main():
    parser = argparse.ArgumentParser(description='Rename Studio — web lokal untuk rename file massal')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    lock_file = None
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
        runtime = ROOT / '.runtime'
        runtime.mkdir(exist_ok=True)
        lock_file = (runtime / 'server.lock').open('a+b')
        lock_file.seek(0, os.SEEK_END)
        if lock_file.tell() == 0:
            lock_file.write(b'0')
            lock_file.flush()
        lock_file.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        server.app = App()
    except (OSError, RenameError) as error:
        if lock_file:
            lock_file.close()
        print(f'Tidak dapat memulai (periksa apakah aplikasi sudah aktif): {error}')
        return 1
    url = f'http://127.0.0.1:{server.server_port}'
    print(f'\nRename Studio aktif: {url}\nFile diproses di komputer ini. Tekan Ctrl+C untuk berhenti.\n', flush=True)
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        lock_file.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
