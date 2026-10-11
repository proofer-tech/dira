#!/usr/bin/env python3
"""remote.py 테스트. http.server 가짜 서버를 세운다 - 뒤 장들이 이 서버에 라우트를 더한다."""
import json
import os
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PREFIX = "/api/runtime/v1/"


class Fake:
    """요청 기록 + 라우트 표. routes[(METHOD, path)] = (status, body) 또는 f(body) -> (status, body)."""

    def __init__(self, workspace="ws1"):
        self.calls = []
        self.token_polls = 0
        self.routes = {
            ("POST", "device/code"): (200, {"device_code": "dc", "user_code": "ABCD-1234",
                                            "verification_uri": "http://x/verify", "interval": 0, "expires_in": 30}),
            ("POST", "device/token"): self._token,
            ("POST", "runtimes"): (200, {"runtime_id": "rt1"}),
            ("DELETE", "runtimes/rt1"): (204, None),
        }
        self.workspace = workspace
        fake = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def handle_any(self):
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n)) if n else None
                path = self.path[len(PREFIX):]
                fake.calls.append((self.command, path, body, self.headers.get("Authorization")))
                r = fake.routes.get((self.command, path), (404, None))
                st, out = r(body) if callable(r) else r
                raw = b"" if out is None else json.dumps(out).encode()
                self.send_response(st)
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            do_GET = do_POST = do_PUT = do_DELETE = handle_any

        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = "http://127.0.0.1:%d" % self.srv.server_port
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def _token(self, body):
        self.token_polls += 1
        if self.token_polls < 2:
            return 428, None
        return 200, {"workspace_id": self.workspace, "runtime_token": "tok-" + self.workspace}

    def close(self):
        self.srv.shutdown()


class T(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        os.makedirs(self.home)
        self.root = os.path.join(self.tmp.name, "proj", ".dira")
        os.makedirs(os.path.join(self.root, "tickets"))
        self.cron = os.path.join(self.tmp.name, "crontab")
        self.fake = Fake()
        self.addCleanup(self.fake.close)
        self.addCleanup(self.tmp.cleanup)

    def run_remote(self, *args):
        env = dict(os.environ, HOME=self.home, DIRA_CRONTAB_FILE=self.cron)
        return subprocess.run([sys.executable, os.path.join(HERE, "remote.py"), *args],
                              capture_output=True, text=True, env=env, timeout=30)

    def connect(self):
        return self.run_remote("connect", self.fake.url, "--root", self.root)

    def cred(self, ws="ws1"):
        return os.path.join(self.home, ".config", "dira", "remote", ws, "credentials.json")

    def test_sync_without_config_is_noop(self):
        r = self.run_remote("sync", "--root", self.root)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.fake.calls, [])

    def test_connect(self):
        r = self.connect()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("ABCD-1234", r.stdout)
        cfg = json.load(open(os.path.join(self.root, "remote.json")))
        self.assertEqual(cfg, {"server": self.fake.url, "workspace_id": "ws1",
                               "runtime_id": "rt1", "project": "proj"})
        self.assertEqual(stat.S_IMODE(os.stat(self.cred()).st_mode), 0o600)
        self.assertEqual(json.load(open(self.cred())), {"runtime_token": "tok-ws1"})
        self.assertNotIn("tok-ws1", open(os.path.join(self.root, "remote.json")).read())
        self.assertTrue(os.access(os.path.join(self.root, "workers", "w1.sh"), os.X_OK))
        self.assertEqual(len([l for l in open(self.cron) if l.strip()]), 2)
        reg = [c for c in self.fake.calls if c[1] == "runtimes"][0]
        self.assertEqual(reg[3], "Bearer tok-ws1")

    def test_connect_keeps_existing_worker(self):
        os.makedirs(os.path.join(self.root, "workers"))
        open(os.path.join(self.root, "workers", "w9.sh"), "w").write("#!/bin/bash\n")
        self.assertEqual(self.connect().returncode, 0)
        self.assertFalse(os.path.exists(os.path.join(self.root, "workers", "w1.sh")))
        self.assertFalse(os.path.exists(self.cron))

    def test_reconnect_same_workspace_does_not_duplicate_cron(self):
        self.connect()
        self.fake.token_polls = 0
        self.assertEqual(self.connect().returncode, 0)
        self.assertEqual(len([l for l in open(self.cron) if l.strip()]), 2)

    def test_other_workspace_rejected(self):
        self.connect()
        self.fake.workspace, self.fake.token_polls = "ws2", 0
        r = self.connect()
        self.assertEqual(r.returncode, 2)
        self.assertIn("이 프로젝트는 이미 다른 워크스페이스에 연결돼 있습니다", r.stderr)
        self.assertEqual(json.load(open(os.path.join(self.root, "remote.json")))["workspace_id"], "ws1")
        self.assertFalse(os.path.exists(self.cred("ws2")))

    def test_disconnect(self):
        self.connect()
        r = self.run_remote("disconnect", "--root", self.root)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(("DELETE", "runtimes/rt1", None, "Bearer tok-ws1"), self.fake.calls)
        self.assertFalse(os.path.exists(os.path.join(self.root, "remote.json")))
        self.assertFalse(os.path.exists(self.cred()))

    def test_sync_interval_and_lock(self):
        self.connect()
        stamp = os.path.join(os.path.dirname(self.cred()), "last-sync")
        r = self.run_remote("sync", "--root", self.root)
        self.assertEqual(r.returncode, 0, r.stderr)
        first = os.stat(stamp).st_mtime
        time.sleep(0.05)
        self.run_remote("sync", "--root", self.root)  # 10초 안 -> 빠진다
        self.assertEqual(os.stat(stamp).st_mtime, first)
        os.utime(stamp, (first - 60, first - 60))  # 간격을 지난 것처럼
        old = os.stat(stamp).st_mtime
        os.mkdir(os.path.join(self.root, ".remote-sync.lock"))
        self.run_remote("sync", "--root", self.root)  # 락 -> 빠진다
        self.assertEqual(os.stat(stamp).st_mtime, old)
        os.rmdir(os.path.join(self.root, ".remote-sync.lock"))
        self.run_remote("sync", "--root", self.root)
        self.assertGreater(os.stat(stamp).st_mtime, old)
        self.assertFalse(os.path.exists(os.path.join(self.root, ".remote-sync.lock")))

    def test_unauthorized_stops_sync(self):
        self.connect()
        import importlib.util
        spec = importlib.util.spec_from_file_location("remote", os.path.join(HERE, "remote.py"))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        self.fake.routes[("GET", "ping")] = (401, None)
        with self.assertRaises(m.Unauthorized):
            m.http(self.fake.url, "GET", "ping", token="bad")


if __name__ == "__main__":
    unittest.main()
