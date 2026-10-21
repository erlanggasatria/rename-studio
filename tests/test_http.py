import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer

from server import App, Handler


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.server.app = App(Path(cls.temp.name) / 'runtime')
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def request(self, path, method='GET', data=None, token=True, origin=None, host=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['X-Rename-Token'] = self.server.app.token
        if origin:
            headers['Origin'] = origin
        if host:
            headers['Host'] = host
        connection.request(method, path, json.dumps(data).encode() if data is not None else None, headers)
        response = connection.getresponse()
        body = response.read()
        status = response.status
        connection.close()
        return status, body

    def test_html_and_assets(self):
        for path in ['/', '/app.js', '/styles.css', '/icon.svg']:
            self.assertEqual(self.request(path)[0], 200)
        html = self.request('/')[1]
        self.assertNotIn(b'__RENAME_TOKEN__', html)
        self.assertIn(self.server.app.token.encode(), html)

    def test_requires_token(self):
        self.assertEqual(self.request('/api/status', token=False)[0], 403)
        self.assertEqual(self.request('/api/undo', 'POST', {}, token=False)[0], 403)

    def test_rejects_cross_origin(self):
        self.assertEqual(self.request('/api/status', origin='https://untrusted.example')[0], 403)

    def test_rejects_dns_rebinding_host(self):
        self.assertEqual(self.request('/', host='attacker.example')[0], 403)
        self.assertEqual(self.request('/api/status', host='attacker.example')[0], 403)

    def test_local_origin_and_token(self):
        self.assertEqual(self.request('/api/status', origin=f'http://127.0.0.1:{self.server.server_port}')[0], 200)

    def test_static_path_allowlist(self):
        self.assertEqual(self.request('/../server.py')[0], 404)
        self.assertEqual(self.request('/.runtime/last-batch.json')[0], 404)

    def test_malformed_body(self):
        self.assertEqual(self.request('/api/folder', 'POST', ['not-a-dict'])[0], 400)

    def test_preview_apply_undo_over_http(self):
        folder = Path(self.temp.name) / 'http-assets'
        folder.mkdir()
        for name in ['one.ai', 'two.eps', 'three.png', 'four.mp4', 'five.JPG']:
            (folder / name).write_bytes(name.encode())
        status, result = self.request('/api/folder', 'POST', {'path': str(folder)})
        self.assertEqual(status, 200)
        files = json.loads(result)['files']
        status, result = self.request('/api/preview', 'POST', {'selected': [file['id'] for file in files], 'prefix': 'Test_', 'start': 1})
        self.assertEqual(status, 200)
        ticket = json.loads(result)['ticket']
        status, result = self.request('/api/apply', 'POST', {'ticket': ticket})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(result)['count'], 5)
        self.assertEqual(len(list(folder.glob('Test_*'))), 5)
        status, result = self.request('/api/undo', 'POST', {})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(result)['count'], 5)
        self.assertEqual((folder / 'four.mp4').read_bytes(), b'four.mp4')


if __name__ == '__main__':
    unittest.main()
