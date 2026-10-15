#!/usr/bin/env python3
"""remote.py 테스트. http.server 가짜 서버를 세운다 - 뒤 장들이 이 서버에 라우트를 더한다."""
import importlib.util
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest import mock
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
                r = fake.routes.get((self.command, path))
                if r is None and path.startswith("reads?"):  # wait 값이 시각마다 달라 접두사로 받는다
                    r = fake.routes.get((self.command, "reads"))
                r = r or (404, None)
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


class Base:
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = os.path.join(self.tmp.name, "home")
        os.makedirs(self.home)
        self.root = os.path.join(self.tmp.name, "proj", ".dira")
        os.makedirs(os.path.join(self.root, "tickets"))
        self.cron = os.path.join(self.tmp.name, "crontab")
        # remote.py 옆 dispatch.py가 진짜면 워커가 뜬다 - 엔진 사본 디렉터리에 부른 인자만 적는 가짜를 둔다
        self.engdir = os.path.join(self.tmp.name, "eng")
        os.makedirs(self.engdir)
        for f in ("remote.py", "ontology_read.py", "graph.py"):
            shutil.copy(os.path.join(HERE, f), self.engdir)
        self.dlog = os.path.join(self.tmp.name, "dispatch.log")
        with open(os.path.join(self.engdir, "dispatch.py"), "w") as f:
            f.write("import json, sys\nopen(%r, 'a').write(json.dumps(sys.argv[1:]) + '\\n')\n"
                    "print(json.dumps({'go': True, 'why': None}))\n" % self.dlog)
        self.fake = Fake()
        self.addCleanup(self.fake.close)
        self.addCleanup(self.tmp.cleanup)

    def run_remote(self, *args):
        env = dict(os.environ, HOME=self.home, DIRA_CRONTAB_FILE=self.cron)
        env.pop("TICKET_ONTOLOGY", None)

        env.pop("TICKET_ONTOLOGY", None)  # 실제 온톨로지를 건드리지 않는다
        return subprocess.run([sys.executable, os.path.join(self.engdir, "remote.py"), *args],
                              capture_output=True, text=True, env=env, timeout=30)

    def dispatched(self):
        try:
            return [json.loads(l) for l in open(self.dlog)]
        except OSError:
            return []

    def connect(self):
        return self.run_remote("connect", self.fake.url, "--root", self.root)

    def cred(self, ws="ws1", root=None):
        key = hashlib.sha256(os.path.realpath(root or self.root).encode()).hexdigest()[:16]
        return os.path.join(self.home, ".config", "dira", "remote", ws, "roots", key, "root.json")

    def wsdir(self, ws="ws1"):
        return os.path.join(self.home, ".config", "dira", "remote", ws)

    def wscred(self, ws="ws1"):
        return os.path.join(self.wsdir(ws), "credentials.json")


class T(Base, unittest.TestCase):
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
        self.assertEqual(stat.S_IMODE(os.stat(self.wscred()).st_mode), 0o600)
        self.assertEqual(json.load(open(self.wscred())), {"runtime_token": "tok-ws1"})
        self.assertEqual(json.load(open(os.path.join(self.wsdir(), "runtime.json"))),
                         {"server": self.fake.url, "runtime_id": "rt1"})
        self.assertEqual(json.load(open(self.cred())),
                         {"queue_root": os.path.realpath(self.root), "project": "proj"})
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.cred()), "credentials.json")))
        self.assertNotIn("tok-ws1", open(os.path.join(self.root, "remote.json")).read())
        self.assertTrue(os.access(os.path.join(self.root, "workers", "w1.sh"), os.X_OK))
        lines = [l for l in open(self.cron) if l.strip()]
        self.assertEqual(len([l for l in lines if "sync-all" in l]), 2)  # 컴퓨터 시계 두 줄
        self.assertEqual(len(lines) - 2, 2)  # 워커 줄
        reg = [c for c in self.fake.calls if c[1] == "runtimes"][0]
        self.assertEqual(reg[3], "Bearer tok-ws1")

    def test_connect_keeps_existing_worker(self):
        os.makedirs(os.path.join(self.root, "workers"))
        open(os.path.join(self.root, "workers", "w9.sh"), "w").write("#!/bin/bash\n")
        self.assertEqual(self.connect().returncode, 0)
        self.assertFalse(os.path.exists(os.path.join(self.root, "workers", "w1.sh")))
        self.assertNotIn("w1.sh", open(self.cron).read())  # 워커 줄은 없고 시계 줄만 있다

    def test_reconnect_same_workspace_does_not_duplicate_cron(self):
        self.connect()
        self.fake.token_polls = 0
        self.assertEqual(self.connect().returncode, 0)
        self.assertEqual(len([l for l in open(self.cron) if l.strip()]), 4)  # 시계 2 + 워커 2, 늘지 않는다

    def test_other_workspace_rejected(self):
        self.connect()
        self.fake.workspace, self.fake.token_polls = "ws2", 0
        r = self.run_remote("connect", self.fake.url, "--root", self.root, "--new")
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
        self.assertFalse(os.path.exists(self.wscred()))

    def second_root(self):
        r2 = os.path.join(self.tmp.name, "proj2", ".dira")
        os.makedirs(os.path.join(r2, "tickets"))
        return r2

    def test_device_code_body(self):
        self.connect()
        body = [c for c in self.fake.calls if c[1] == "device/code"][0][2]
        self.assertEqual(set(body), {"machine_name", "project", "queue_root", "tools"})
        self.assertEqual(body["project"], "proj")
        self.assertEqual(body["queue_root"], os.path.realpath(self.root))
        self.assertEqual(body["tools"], [])

    def test_two_roots_same_workspace_isolated(self):
        r2 = self.second_root()
        self.connect()
        r = self.run_remote("connect", self.fake.url, "--root", r2)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotEqual(self.cred(), self.cred(root=r2))
        stamp1 = os.path.join(os.path.dirname(self.cred()), "last-sync")
        self.run_remote("sync", "--root", self.root)
        self.assertTrue(os.path.exists(stamp1))
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.cred(root=r2)), "last-sync")))
        self.assertTrue(self.run_remote("sync", "--root", r2).returncode == 0)
        self.assertTrue(os.path.exists(os.path.join(os.path.dirname(self.cred(root=r2)), "last-sync")))
        self.assertEqual(self.run_remote("disconnect", "--root", r2).returncode, 0)
        self.assertFalse(os.path.exists(os.path.dirname(self.cred(root=r2))))
        self.assertTrue(os.path.exists(self.cred()))
        self.assertTrue(os.path.exists(os.path.join(self.wsdir(), "health.json")))

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

    # ---- P478-3: 작업 잡기-상태 보고-작업 토큰 ----

    def sync(self):
        stamp = os.path.join(os.path.dirname(self.cred()), "last-sync")
        if os.path.exists(stamp):
            os.utime(stamp, (1, 1))  # 10초 간격을 건너뛴다
        r = self.run_remote("sync", "--root", self.root)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r

    def setup_jobs(self, jobs):
        eng = os.path.join(self.home, ".config", "dira", "bin", "engines")
        os.makedirs(eng, exist_ok=True)
        open(os.path.join(eng, "claude"), "w").write("#!/bin/sh\necho 1.0\n")  # 로그인 점검 통과
        os.chmod(os.path.join(eng, "claude"), 0o755)
        self.connect()  # 점검은 연결 때만 그 자리에서 돈다 - 도구를 먼저 둔다
        os.makedirs(os.path.join(self.root, "workers"), exist_ok=True)
        for w in ("w1", "w2"):
            open(os.path.join(self.root, "workers", w + ".sh"), "w").write("#!/bin/bash\n")
        self.fake.routes[("POST", "jobs/claim")] = lambda b: (200, {"jobs": jobs.pop(0) if jobs else []})
        self.fake.routes[("POST", "jobs/J1/status")] = (204, None)

    def statuses(self, job="J1"):
        return [c[2]["state"] for c in self.fake.calls if c[1] == "jobs/%s/status" % job]

    def job(self):
        return {"job_id": "J1", "title": "원고 쓰기", "persona": "writer", "priority": 2,
                "duedate": "2026-12-01", "body": "## Goal\n\n써라\n", "job_token": "SECRET-JT",
                "job_token_expires_at": "2027-01-01T00:00:00+00:00"}

    def tickets(self):
        return sorted(os.listdir(os.path.join(self.root, "tickets")))

    def test_claim_creates_ticket_once_with_token_file(self):
        self.setup_jobs([[self.job()], [self.job()]])
        self.sync()
        self.sync()  # 같은 job_id 를 다시 줘도 둘이 되지 않는다
        names = self.tickets()
        self.assertEqual(len(names), 1, names)
        h = names[0][:-3]
        self.assertRegex(h, r"^[0-9a-f]{8}$")
        text = open(os.path.join(self.root, "tickets", names[0])).read()
        for want in ("ticket: " + h, "kind: work", "persona: writer", "remote_job: J1", "duedate: 2026-12-01"):
            self.assertIn(want, text)
        self.assertIn("## Goal\n\n써라", text)
        self.assertNotIn("SECRET-JT", text)
        tok = os.path.join(self.home, ".config", "dira", "run", "remote-jobs", h + ".json")
        self.assertEqual(stat.S_IMODE(os.stat(tok).st_mode), 0o600)
        self.assertEqual(json.load(open(tok))["job_token"], "SECRET-JT")
        claim = [c for c in self.fake.calls if c[1] == "jobs/claim"][0]
        self.assertEqual(claim[2]["max"], 2)

    def two_jobs(self):
        return [dict(self.job(), job_id="J1"), dict(self.job(), job_id="J2")]

    def test_claimed_jobs_dispatch_direct_on_distinct_workers(self):
        self.setup_jobs([self.two_jobs()])
        self.sync()
        hs = [n[:-3] for n in self.tickets()]
        calls = self.dispatched()
        self.assertEqual(len(calls), 2, calls)
        for c in calls:
            self.assertEqual(c[:2], ["run", self.root])
            self.assertEqual(c[c.index("--reason") + 1], "direct")
        self.assertEqual(sorted(c[c.index("--hash") + 1] for c in calls), sorted(hs))
        self.assertEqual(sorted(c[c.index("--worker") + 1] for c in calls), ["w1", "w2"])

    def test_no_new_job_no_dispatch(self):
        self.setup_jobs([[], [self.job()], [self.job()]])
        self.sync()
        self.assertEqual(self.dispatched(), [])
        self.sync()
        self.assertEqual(len(self.dispatched()), 1)
        self.sync()  # 이미 있는 job_id
        self.assertEqual(len(self.dispatched()), 1)

    def test_missing_dispatch_py_still_creates_ticket(self):
        self.setup_jobs([[self.job()]])
        os.unlink(os.path.join(self.engdir, "dispatch.py"))
        r = self.sync()
        self.assertEqual(len(self.tickets()), 1)
        self.assertIn("REMOTE dispatch-missing", r.stdout)

    def test_not_candidate_skips_hash_other_failure_tries_next_worker(self):
        self.setup_jobs([self.two_jobs()])
        with open(os.path.join(self.engdir, "dispatch.py"), "w") as f:
            f.write("import json, sys\nopen(%r, 'a').write(json.dumps(sys.argv[1:]) + '\\n')\n"
                    "print(json.dumps({'go': False, 'why': '워커가 바쁘다'}))\nsys.exit(1)\n" % self.dlog)
        self.sync()
        ws = [c[c.index("--worker") + 1] for c in self.dispatched()]
        self.assertEqual(ws, ["w1", "w2"])  # 첫 해시가 w1 w2 를 다 써서 둘째는 워커가 없다

    def test_status_transitions_reported_once_and_token_removed(self):
        self.setup_jobs([[self.job()]])
        self.sync()
        tdir = os.path.join(self.root, "tickets")
        h = self.tickets()[0][:-3]
        tok = os.path.join(self.home, ".config", "dira", "run", "remote-jobs", h + ".json")
        self.sync()
        self.assertEqual(self.statuses(), [])  # 아직 아무도 안 잡았다
        os.rename(os.path.join(tdir, h + ".md"), os.path.join(tdir, h + ".wip.md"))
        self.sync()
        self.sync()
        self.assertEqual(self.statuses(), ["running"])
        self.assertTrue(os.path.exists(tok))
        os.rename(os.path.join(tdir, h + ".wip.md"), os.path.join(tdir, h + ".done.md"))
        self.sync()
        self.sync()
        self.assertEqual(self.statuses(), ["running", "done"])
        self.assertFalse(os.path.exists(tok))
        last = [c for c in self.fake.calls if c[1] == "jobs/J1/status"][-1][2]
        self.assertEqual(last["hash"], h)
        self.assertIn("at", last)

    def test_block_then_awaiting_keeps_token_until_done(self):
        self.setup_jobs([[self.job()]])
        self.fake.routes[("POST", "jobs/J1/questions")] = (204, None)
        self.sync()
        tdir = os.path.join(self.root, "tickets")
        h = self.tickets()[0][:-3]
        p = os.path.join(tdir, h + ".wip.md")
        os.rename(os.path.join(tdir, h + ".md"), p)
        tok = os.path.join(self.home, ".config", "dira", "run", "remote-jobs", h + ".json")
        open(p, "a").write("\n## 블록\n막힘\n")
        self.sync()
        self.assertEqual(self.statuses(), ["running"])  # 블록만 있는 .wip 은 running
        text = open(p).read()
        open(p, "w").write(text.replace("remote_job: J1", "remote_job: J1\nawaiting: abcd1234") + "\n## 질문 1\n\n어느 쪽?\n")
        self.sync()
        self.assertEqual(self.statuses(), ["running", "awaiting"])
        self.assertEqual([c[1] for c in self.fake.calls].count("jobs/J1/questions"), 1)
        self.assertTrue(os.path.exists(tok))
        open(os.path.join(tdir, "abcd1234.done.md"), "w").write("x")
        self.sync()
        self.assertEqual(self.statuses(), ["running", "awaiting", "running"])
        self.assertTrue(os.path.exists(tok))
        os.rename(p, os.path.join(tdir, h + ".done.md"))
        self.sync()
        self.assertEqual(self.statuses(), ["running", "awaiting", "running", "done"])
        self.assertFalse(os.path.exists(tok))

    def test_notoken_closes_ticket_and_reports_failed_with_reason(self):
        self.setup_jobs([[self.job()]])
        self.sync()
        tdir = os.path.join(self.root, "tickets")
        h = self.tickets()[0][:-3]
        p = os.path.join(tdir, h + ".wip.md")
        os.rename(os.path.join(tdir, h + ".md"), p)
        text = open(p).read()
        open(p, "w").write(text.replace("remote_job: J1", "remote_job: J1\npid: 1\nsession_id: s\nowner: o\ninbox: i\nassigned_at: a"))
        r = subprocess.run([sys.executable, os.path.join(HERE, "remote.py"), "notoken", p], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertFalse(os.path.exists(p))
        done = open(os.path.join(tdir, h + ".done.md")).read()
        self.assertIn("remote_failed: no-token", done)
        for k in ("pid:", "session_id:", "owner:", "inbox:", "assigned_at:"):
            self.assertNotIn(k, done)
        self.assertEqual(done.count("## 결과"), 1)
        self.assertIn("작업 토큰 파일이 없어", done)
        self.sync()
        last = [c for c in self.fake.calls if c[1] == "jobs/J1/status"][-1][2]
        self.assertEqual((last["state"], last["reason"]), ("failed", "no-token"))
        r = subprocess.run([sys.executable, os.path.join(HERE, "remote.py"), "notoken", p], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)

    def test_410_marks_revoked_and_stops(self):
        self.setup_jobs([[self.job()]])
        self.sync()
        tdir = os.path.join(self.root, "tickets")
        h = self.tickets()[0][:-3]
        os.rename(os.path.join(tdir, h + ".md"), os.path.join(tdir, h + ".wip.md"))
        self.fake.routes[("POST", "jobs/J1/status")] = (410, None)
        self.sync()
        text = open(os.path.join(tdir, h + ".wip.md")).read()
        self.assertIn("remote_revoked: true", text)
        self.assertNotIn("## 블록", text)
        self.sync()
        os.rename(os.path.join(tdir, h + ".wip.md"), os.path.join(tdir, h + ".done.md"))
        self.sync()
        self.assertEqual(len(self.statuses()), 1)

    # ---- P478-5: 진행 기록-질문-답 ----

    def wip_job(self, extra=""):
        self.setup_jobs([[self.job()]])
        self.fake.routes[("POST", "jobs/J1/events")] = (204, None)
        self.fake.routes[("POST", "jobs/J1/questions")] = (204, None)
        self.sync()
        tdir = os.path.join(self.root, "tickets")
        h = self.tickets()[0][:-3]
        p = os.path.join(tdir, h + ".wip.md")
        os.rename(os.path.join(tdir, h + ".md"), p)
        if extra:
            text = open(p).read()
            open(p, "w").write(text.replace("remote_job: J1", "remote_job: J1\n" + extra))
        return tdir, h, p

    def events(self):
        return [e for c in self.fake.calls if c[1] == "jobs/J1/events" for e in c[2]["events"]]

    def test_events_from_session_log(self):
        tdir, h, p = self.wip_job()
        logs = os.path.join(self.root, "workers", "logs")
        os.makedirs(logs)

        def tu(name, **inp):
            return {"type": "assistant", "message": {"content": [
                {"type": "text", "text": "SECRET-MODEL-TEXT"},
                {"type": "tool_use", "name": name, "input": inp}]}}
        lines = [tu("Read", file_path="/x"), tu("Grep", pattern="p"), tu("Edit", file_path="/y"),
                 tu("Bash", command="ls -la"), tu("Bash", command="é" * 1500),
                 tu("Write", file_path="/r/tickets/deadbeef.md"),
                 {"type": "user", "message": {"content": [{"type": "tool_result", "content": "SECRET-RESULT"}]}}]
        lp = os.path.join(logs, "20261011-000000-w1-%s.log" % h)
        with open(lp, "w") as f:
            for l in lines:
                f.write(json.dumps(l) + "\n")
            f.write('{"type":"assistant","mess')  # 덜 쓰인 끝줄은 다음에
        self.sync()
        evs = self.events()
        self.assertEqual([e["step"] for e in evs if e["step"]], ["read", "wrote", "handoff"])
        cmds = [e["command"] for e in evs if e["command"]]
        self.assertEqual(cmds[0], "ls -la")
        self.assertEqual(len(cmds[1].encode()), 2000)
        raw = json.dumps([c[2] for c in self.fake.calls if c[1] == "jobs/J1/events"])
        self.assertNotIn("SECRET", raw)
        n = len(evs)
        self.sync()
        self.assertEqual(len(self.events()), n)  # 같은 줄을 두 번 안 올린다
        with open(lp, "a") as f:
            f.write(json.dumps(tu("Read", file_path="/z")) + "\n")
        self.sync()
        self.assertEqual(len(self.events()), n)  # read는 첫 사용만

    def test_question_once_and_answer_written_not_overwritten(self):
        tdir, h, p = self.wip_job("awaiting: abcd1234")
        with open(p, "a") as f:
            f.write("\n## 질문 1\n\n### 1. 뭐부터\n\n- (a) 이거\n- (b) 저거\n\n## 질문 2\n\n### 1. 둘째\n\n- (a) 예\n")
        self.sync()
        self.sync()
        qs = [c[2] for c in self.fake.calls if c[1] == "jobs/J1/questions"]
        self.assertEqual(len(qs), 1)
        self.assertEqual(qs[0]["stem"], "abcd1234")
        self.assertTrue(qs[0]["markdown"].startswith("## 질문 2"))
        self.assertNotIn("질문 1", qs[0]["markdown"])
        self.assertIn("awaiting", [e["step"] for e in self.events()])
        ans = {"job_id": "J1", "stem": "abcd1234", "markdown": "(a)로 가세요"}
        self.fake.routes[("GET", "answers?runtime_id=rt1&project=proj")] = (200, {"answers": [ans]})
        self.sync()
        text = open(os.path.join(tdir, "abcd1234.done.md")).read()
        self.assertTrue(text.startswith("---\nkind: answer\nticket: abcd1234\n---\n"))
        self.assertIn("(a)로 가세요", text)
        open(os.path.join(tdir, "abcd1234.done.md"), "w").write("사람이 먼저")
        self.sync()
        self.assertEqual(open(os.path.join(tdir, "abcd1234.done.md")).read(), "사람이 먼저")

    def test_answer_for_unknown_stem_rejected(self):
        tdir, h, p = self.wip_job("awaiting: abcd1234")
        bad = [{"job_id": "J1", "stem": "../evil", "markdown": "x"},
               {"job_id": "J1", "stem": "ffffffff", "markdown": "x"}]
        self.fake.routes[("GET", "answers?runtime_id=rt1&project=proj")] = (200, {"answers": bad})
        self.sync()
        self.assertEqual([n for n in os.listdir(tdir) if "answer" in n or n.startswith("ffff")], [])
        self.assertFalse(os.path.exists(os.path.join(self.root, "evil.done.md")))

    # ---- P478-4: tick.sh 연결 ----

    def worker(self, engine="fake"):
        """<루트>/workers/w1.sh. fake 엔진은 환경과 인자를 파일로 떨군다."""
        self.local = os.path.join(self.tmp.name, "local")
        os.makedirs(self.local, exist_ok=True)
        self.eng = os.path.join(self.tmp.name, "fake-engine.sh")
        open(self.eng, "w").write('#!/bin/bash\nenv > "%s/env.txt"\nprintf \'%%s\\n\' "$@" > "%s/argv.txt"\n'
                                  'printf \'{"session_id":"x"}\\n\'\n' % (self.tmp.name, self.tmp.name))
        os.chmod(self.eng, 0o755)
        wdir = os.path.join(self.root, "workers")
        os.makedirs(wdir, exist_ok=True)
        eng = 'TICKET_ENGINE=("%s" "{prompt}")\n' % self.eng if engine == "fake" else ""
        w = os.path.join(wdir, "w1.sh")
        open(w, "w").write('#!/bin/bash\nTICKET_NAME="w1"\nTICKET_CWD="%s"\n%s. "%s"\n'
                           % (self.tmp.name, eng, os.path.join(HERE, "tick.sh")))
        os.chmod(w, 0o755)
        return w

    def wrun(self, w, cmd):
        # PATH에 진짜 claude가 없어야 tick이 가짜 엔진 자리를 구워 덮지 않는다
        env = dict(os.environ, HOME=self.home, TICKET_LOCAL=self.local, DIRA_CRONTAB_FILE=self.cron,
                   PATH=os.path.dirname(sys.executable) + ":/usr/bin:/bin:/usr/sbin:/sbin")
        r = subprocess.run([w, cmd], capture_output=True, text=True, env=env, timeout=60)
        return r.stdout + r.stderr

    def test_dryrun_without_remote_json_has_no_remote(self):
        w = self.worker()
        open(os.path.join(self.root, "tickets", "aaaa0001.md"), "w").write("---\nticket: aaaa0001\ntitle: t\n---\n\n## Goal\nx\n")
        out = self.wrun(w, "dryrun")
        self.assertIn("선정: aaaa0001", out)
        self.assertNotIn("REMOTE", out)
        self.wrun(w, "tick")
        self.assertEqual(self.fake.calls, [])
        self.assertNotIn("DIRA_REMOTE", open(os.path.join(self.tmp.name, "env.txt")).read())

    def test_tick_syncs_then_dispatches_with_job_token_env(self):
        self.setup_jobs([[self.job()]])
        os.makedirs(os.path.join(self.root, "personas", "writer"))
        open(os.path.join(self.root, "personas", "writer", "mcp.json"), "w").write("{}")
        w = self.worker()
        out = self.wrun(w, "tick")
        env = open(os.path.join(self.tmp.name, "env.txt")).read()
        self.assertIn("DIRA_REMOTE_TOKEN=SECRET-JT", env)
        self.assertIn("DIRA_REMOTE_URL=" + self.fake.url + "\n", env)
        self.assertIn("MCPSKIP", open(os.path.join(self.root, "workers", "runner.log")).read())
        # 토큰 값은 티켓-로그 어디에도 없다
        for base, _, files in os.walk(self.tmp.name):
            for n in files:
                if n in ("env.txt",) or base.startswith(os.path.join(self.home, ".config", "dira", "run", "remote-jobs")):
                    continue
                try:
                    self.assertNotIn("SECRET-JT", open(os.path.join(base, n), errors="ignore").read(), n)
                except IsADirectoryError:
                    pass
        # remote_job 없는 티켓의 세션에는 두 변수가 없다
        tdir = os.path.join(self.root, "tickets")
        for n in os.listdir(tdir):
            os.rename(os.path.join(tdir, n), os.path.join(tdir, n.replace(".wip", "").replace(".md", ".done.md") if ".done" not in n else n))
        open(os.path.join(tdir, "bbbb0001.md"), "w").write("---\nticket: bbbb0001\ntitle: t\n---\n\n## Goal\nx\n")
        self.wrun(w, "tick")
        self.assertNotIn("DIRA_REMOTE", open(os.path.join(self.tmp.name, "env.txt")).read())

    def test_tick_closes_remote_ticket_without_token_file(self):
        tdir = os.path.join(self.root, "tickets")
        self.setup_jobs([])
        w = self.worker()
        text = "---\nticket: dddd0001\ntitle: t\nremote_job: JX\n---\n\n## Goal\nx\n"
        open(os.path.join(tdir, "dddd0001.md"), "w").write(text)
        self.wrun(w, "tick")
        log = open(os.path.join(self.root, "workers", "runner.log")).read()
        self.assertIn("REMOTE-NOTOKEN dddd0001", log)
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, "env.txt")))  # 세션이 안 떴다
        self.assertIn("remote_failed: no-token", open(os.path.join(tdir, "dddd0001.done.md")).read())
        # remote.json이 없으면 검사가 안 돈다
        os.unlink(os.path.join(self.root, "remote.json"))
        open(os.path.join(tdir, "dddd0002.md"), "w").write(text.replace("dddd0001", "dddd0002"))
        self.wrun(w, "tick")
        self.assertNotIn("REMOTE-NOTOKEN dddd0002", open(os.path.join(self.root, "workers", "runner.log")).read())
        self.assertTrue(os.path.exists(os.path.join(self.tmp.name, "env.txt")))

    def test_claude_argv_has_mcp_config_only_for_persona_with_file(self):
        self.setup_jobs([])
        os.makedirs(os.path.join(self.root, "personas", "writer"))
        open(os.path.join(self.root, "personas", "writer", "mcp.json"), "w").write("{}")
        w = self.worker(engine=None)
        tdir = os.path.join(self.root, "tickets")
        for h, per in (("cccc0001", "writer"), ("cccc0002", "plain")):
            open(os.path.join(tdir, h + ".md"), "w").write("---\nticket: %s\ntitle: t\npersona: %s\n---\n\n## Goal\nx\n" % (h, per))
        out = self.wrun(w, "dryrun")
        self.assertIn("--mcp-config " + os.path.join(os.path.realpath(self.root), "personas", "writer", "mcp.json"), out)
        os.rename(os.path.join(tdir, "cccc0001.md"), os.path.join(tdir, "cccc0001.done.md"))
        out = self.wrun(w, "dryrun")
        self.assertIn("선정: cccc0002", out)
        self.assertNotIn("--mcp-config", out)

    def test_heartbeat_goes_even_when_worker_lock_held(self):
        self.setup_jobs([])
        w = self.worker()
        import hashlib
        h = hashlib.sha1((os.path.join(os.path.realpath(self.root), "workers")  + "/w1").encode()).hexdigest()[:8]
        run = os.path.join(self.local, "run")
        os.makedirs(os.path.join(run, "w1-%s.lock" % h))
        open(os.path.join(run, "w1-%s.lock" % h, "pid"), "w").write(str(os.getpid()))
        self.wrun(w, "tick")
        self.assertFalse(os.path.exists(os.path.join(self.tmp.name, "env.txt")))  # 세션은 안 떴다
        self.assertEqual(open(self.cron).read().count("sync-all"), 2)  # 워커 락과 무관하게 tick이 시계 줄을 넣었다

    def test_launcher_remote_help(self):
        r = subprocess.run([sys.executable, os.path.join(HERE, "remote.py"), "connect", "--help"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0)
        self.assertIn("server", r.stdout)


class Tools(Base, unittest.TestCase):
    """가짜 엔진 실행 파일과 가짜 시계로 런타임-로그인 점검-heartbeat를 본다."""

    def setUp(self):
        super().setUp()
        d = os.path.join(self.home, ".config", "dira", "bin", "engines")
        os.makedirs(d)
        for n in ("claude", "codex"):
            p = os.path.join(d, n)
            open(p, "w").write('#!/bin/bash\n[ "$1" = --version ] && { echo "%s 1.2.3"; exit 0; }\n'
                               'echo "$0" >> "%s/logins.log"; [ -e "%s/fail-%s" ] && exit 1; exit 0\n'
                               % (n, self.home, self.home, n))
            os.chmod(p, 0o755)
        os.makedirs(os.path.join(self.root, "workers"))
        for w in ("w1", "w2"):
            open(os.path.join(self.root, "workers", w + ".sh"), "w").write("#!/bin/bash\n")
        open(os.path.join(self.root, "tickets", "abcd1234.wip.md"), "w").write(
            "---\nticket: abcd1234\nowner: developer / w2-2124f3e8\n---\n")
        self.fake.routes[("POST", "runtimes/rt1/heartbeat")] = (200, {"ok": True})
        os.environ["HOME"] = self.home
        self.addCleanup(os.environ.__setitem__, "HOME", self.orig_home)
        spec = importlib.util.spec_from_file_location("remote", os.path.join(HERE, "remote.py"))
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)
        self.clock = time.time()
        self.m.now = lambda: self.clock

    orig_home = os.environ["HOME"]

    def logins(self):
        p = os.path.join(self.home, "logins.log")
        return len(open(p).read().split()) if os.path.exists(p) else 0

    def hb(self):
        return [c for c in self.fake.calls if c[1] == "runtimes/rt1/heartbeat"][-1][2]

    def test_connect_reports_tools_with_version(self):
        self.assertEqual(self.connect().returncode, 0)
        reg = [c for c in self.fake.calls if c[1] == "runtimes"][0][2]
        self.assertEqual(reg["tools"], [{"name": "claude", "version": "claude 1.2.3", "health": "ok"},
                                        {"name": "codex", "version": "codex 1.2.3", "health": "ok"}])

    def test_failed_login_is_needs_check_and_not_claimed(self):
        open(os.path.join(self.home, "fail-codex"), "w").close()
        self.connect()
        reg = [c for c in self.fake.calls if c[1] == "runtimes"][0][2]
        self.assertEqual({t["name"]: t["health"] for t in reg["tools"]},
                         {"claude": "ok", "codex": "needs_check"})
        self.assertEqual(self.m.claim_tools("ws1"), ["claude"])

    def test_heartbeat_workers(self):
        self.connect()
        self.run_remote("sync-all")
        w = {x["name"]: x for x in self.hb()["projects"][0]["workers"]}
        self.assertEqual(w["w2"]["busy"], "abcd1234")
        self.assertIsNone(w["w1"]["busy"])
        import datetime
        t = datetime.datetime.fromisoformat(w["w1"]["next_dispatch_at"])
        self.assertIn(t.second, (0, 30))
        self.assertIsNotNone(t.utcoffset())

    def test_login_check_schedule(self):
        self.connect()
        self.m.spawn_check = self.m.run_check  # 백그라운드 자식 대신 그 자리에서 돌려 횟수를 센다
        self.assertEqual(self.logins(), 2)  # 연결 때
        h = json.load(open(self.m.health_path("ws1")))["tools"]
        self.clock = max(v["checked_at"] for v in h.values())  # 가짜 시계를 기록 시각에 맞춘다
        self.m.refresh_health("ws1")
        self.assertEqual(self.logins(), 2)  # 곧바로는 안 돈다
        self.clock += 6 * 3600 - 1
        self.m.refresh_health("ws1")
        self.assertEqual(self.logins(), 2)
        self.clock += 1
        self.m.refresh_health("ws1")  # 6시간
        self.assertEqual(self.logins(), 4)
        self.m.mark_auth_error("ws1", "codex")
        self.m.refresh_health("ws1")  # 인증 오류 직후 - 그 도구만
        self.assertEqual(self.logins(), 5)
        self.m.refresh_health("ws1")
        self.assertEqual(self.logins(), 5)
        self.run_remote("sync", "--root", self.root)  # 일반 sync도 점검을 늘리지 않는다
        self.assertEqual(self.logins(), 5)

    def test_stale_check_does_not_block_heartbeat(self):
        """6시간 지난 점검이 sync의 timeout 20 안에서 하트비트를 막지 않고, 결과는 health.json에 남는다."""
        self.connect()
        d = os.path.join(self.home, ".config", "dira", "bin", "engines")
        for n in ("claude", "codex"):  # 점검 한 번이 timeout 20을 넘기는 도구(실측 166초)
            open(os.path.join(d, n), "w").write(
                '#!/bin/bash\n[ "$1" = --version ] && { echo "%s 1.2.3"; exit 0; }\n'
                'sleep 12; echo "$0" >> "%s/logins.log"; exit 0\n' % (n, self.home))
        hp = self.m.health_path("ws1")
        st = json.load(open(hp))
        for v in st["tools"].values():
            v["checked_at"] -= 7 * 3600
        json.dump(st, open(hp, "w"))
        before = self.logins()
        to = ["timeout", "20"] if shutil.which("timeout") else []
        env = dict(os.environ, HOME=self.home, DIRA_CRONTAB_FILE=self.cron)
        env.pop("TICKET_ONTOLOGY", None)
        t0 = time.time()
        r = subprocess.run(to + [sys.executable, os.path.join(HERE, "remote.py"), "sync-all"],
                           capture_output=True, text=True, env=env, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertLess(time.time() - t0, 10)
        self.assertEqual({t["health"] for t in self.hb()["tools"]}, {"ok"})  # 직전 값으로 보냈다
        os.utime(os.path.join(os.path.dirname(self.cred()), "last-sync"), (1, 1))
        os.utime(os.path.join(self.home, ".config", "dira", "remote", "ws1", "last-heartbeat"), (1, 1))
        self.run_remote("sync-all")  # 점검 중인 동안 다음 신호는 다시 띄우지 않는다
        deadline = time.time() + 45
        while time.time() < deadline and "checking_since" in json.load(open(hp)):
            time.sleep(0.5)
        st = json.load(open(hp))
        self.assertNotIn("checking_since", st)
        self.assertEqual(self.logins() - before, 2)  # 도구당 한 번
        self.assertTrue(all(time.time() - v["checked_at"] < 60 for v in st["tools"].values()))
        os.utime(os.path.join(os.path.dirname(self.cred()), "last-sync"), (1, 1))
        os.utime(os.path.join(self.home, ".config", "dira", "remote", "ws1", "last-heartbeat"), (1, 1))
        self.run_remote("sync-all")  # 새로 써졌으니 더 돌지 않는다
        time.sleep(1)
        self.assertNotIn("checking_since", json.load(open(hp)))

    # ---- 온톨로지 올리기-원격 쓰기 ----
    def ont_setup(self):
        self.connect()
        self.ont = os.path.join(self.root, "ontology")
        os.makedirs(os.path.join(self.ont, "objects", "t"))
        self.puts = []
        self.fake.routes[("PUT", "objects?project=proj")] = lambda b: (self.puts.append(b) or (204, None))
        self.stamp = os.path.join(os.path.dirname(self.cred()), "last-sync")

    def osync(self):
        if os.path.exists(self.stamp):
            os.utime(self.stamp, (1, 1))
        r = self.run_remote("sync", "--root", self.root)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("Error", r.stdout)

    def test_sync_does_not_push_objects(self):
        # P496: O4 올리기를 껐다 - 객체를 고쳐도 PUT objects가 안 간다
        self.ont_setup()
        open(os.path.join(self.ont, "objects", "t", "o1.md"), "w").write("a")
        self.osync()
        open(os.path.join(self.ont, "objects", "t", "o1.md"), "w").write("edited")
        self.osync()
        self.assertEqual(self.puts, [])
        self.assertFalse([c for c in self.fake.calls if c[0] == "PUT"])

    # ---- 원격 읽기 긴 대기 (P496) ----
    def read_setup(self, reads):
        self.ont_setup()
        self.fake.routes[("POST", "runtimes/rt1/heartbeat")] = (200, {"ok": True})
        open(os.path.join(self.ont, "objects", "t", "o1.md"), "w").write("---\nname: o1\ntype: t\n---\nbody\n")
        self.answers = {}
        queue = list(reads)
        self.fake.routes[("GET", "reads")] = lambda _b: (200, {"reads": [queue.pop(0)] if queue else []})
        for r in reads:
            self.fake.routes[("POST", "reads/" + r["read_id"])] = \
                (lambda rid: lambda b: (self.answers.__setitem__(rid, b) or (200, {"ok": True})))(r["read_id"])

    def sync_all_deadline(self, secs):
        os.environ["DIRA_READ_DEADLINE"] = str(time.time() + secs)
        self.addCleanup(os.environ.pop, "DIRA_READ_DEADLINE", None)
        t0 = time.time()
        r = self.run_remote("sync-all")
        return r, time.time() - t0

    def test_read_answered_within_deadline(self):
        self.read_setup([{"read_id": "r1", "op": "object", "args": {"name": "o1"}, "project": "proj"},
                         {"read_id": "r2", "op": "object", "args": {"name": "o1"}, "project": "nope"},
                         {"read_id": "r3", "op": "bogus", "args": {}}])
        r, dt = self.sync_all_deadline(20)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertLess(dt, 28)
        self.assertEqual(self.answers["r1"]["result"]["object"]["name"], "o1")
        self.assertNotIn("errors", self.answers["r1"])
        self.assertEqual(self.answers["r2"], {"error": "unknown project"})  # 모르는 프로젝트
        self.assertIn("error", self.answers["r3"])  # 모르는 op
        self.assertFalse([c for c in self.fake.calls if c[0] == "PUT"])
        hb = [c for c in self.fake.calls if c[1] == "runtimes/rt1/heartbeat"][-1][2]
        self.assertIs(hb["reads"], True)

    def test_reads_404_does_not_wait(self):
        self.ont_setup()
        self.fake.routes[("POST", "runtimes/rt1/heartbeat")] = (200, {"ok": True})
        r, dt = self.sync_all_deadline(20)
        self.assertEqual(r.returncode, 0, r.stderr)
        # P497: 감시 스레드는 마감까지 돌므로 시간은 재지 않고, 읽기 요청을 되풀이하지 않는지만 본다
        self.assertEqual(len([c for c in self.fake.calls if c[0] == "GET" and c[1].startswith("reads?")]), 1)

    def write_op(self, writes):
        self.posts = {}
        self.fake.routes[("GET", "writes?runtime_id=rt1&project=proj")] = (200, {"writes": writes})
        for w in writes:
            self.fake.routes[("POST", "writes/" + w["op_id"])] = \
                (lambda b, o=w["op_id"]: (self.posts.__setitem__(o, b) or (204, None)))
        self.osync()

    def actionlog(self):
        d = os.path.join(self.ont, "action-log")
        return "".join(open(os.path.join(d, n)).read() for n in os.listdir(d)) if os.path.isdir(d) else ""

    def test_remote_write_apply_and_conflict(self):
        self.ont_setup()
        f = os.path.join(self.ont, "objects", "t", "n1.md")
        self.write_op([{"op_id": "op1", "path": "objects/t/n1.md", "base_sha256": None, "content": "v1"}])
        self.assertEqual(self.posts["op1"], {"result": "applied"})
        self.assertEqual(open(f).read(), "v1")
        self.assertRegex(self.actionlog(), r"- \d\d:\d\d 새객체: n1 - 원격 편집 \(op op1\)\n")
        import hashlib
        h = hashlib.sha256(b"v1").hexdigest()
        self.write_op([{"op_id": "op2", "path": "objects/t/n1.md", "base_sha256": h, "content": "v2"}])
        self.assertEqual(open(f).read(), "v2")
        self.assertIn("값갱신: n1 - 원격 편집 (op op2)", self.actionlog())
        self.write_op([{"op_id": "op3", "path": "objects/t/n1.md", "base_sha256": h, "content": "v3"}])
        self.assertEqual(self.posts["op3"]["result"], "conflict")
        self.assertEqual(open(f).read(), "v2")
        self.assertNotIn("op op3", self.actionlog())
        self.write_op([{"op_id": "op4", "path": "objects/t/n1.md", "base_sha256": None, "content": "v4"}])
        self.assertEqual(self.posts["op4"]["result"], "conflict")

    def test_remote_write_rejects_escape(self):
        self.ont_setup()
        outside = os.path.join(self.tmp.name, "outside")
        os.makedirs(outside)
        os.symlink(outside, os.path.join(self.ont, "objects", "link"))
        os.symlink(os.path.join(outside, "x.md"), os.path.join(self.ont, "objects", "t", "sl.md"))
        bad = ["../x.md", "objects/../x.md", "/etc/x.md", "objects/link/x.md", "objects/t/sl.md",
               "SCHEMA.md", "objects/t/x.txt", "action-log/x.md"]
        self.write_op([{"op_id": "b%d" % i, "path": p, "base_sha256": None, "content": "z"}
                       for i, p in enumerate(bad)])
        for i in range(len(bad)):
            self.assertEqual(self.posts["b%d" % i]["result"], "conflict", bad[i])
        self.assertEqual(os.listdir(outside), [])
        self.assertFalse(os.path.exists(os.path.join(self.ont, "x.md")))
        self.assertEqual(self.actionlog(), "")

    def test_remote_write_creates_missing_parents_and_quotes_op(self):
        # 새 프로젝트: objects/-versions/ 가 아예 없다. 한글 op_id 는 quote 해서 보고한다
        self.connect()
        self.ont = os.path.join(self.root, "ontology")
        self.fake.routes[("PUT", "objects?project=proj")] = (204, None)
        self.stamp = os.path.join(os.path.dirname(self.cred()), "last-sync")
        import urllib.parse
        ws = [{"op_id": "글감-1", "path": "objects/글감/a1-첫글.md", "base_sha256": None, "content": "본"},
              {"op_id": "판-1", "path": "versions/글감/a1-첫글/1.md", "base_sha256": None, "content": "지난"}]
        self.posts = {}
        self.fake.routes[("GET", "writes?runtime_id=rt1&project=proj")] = (200, {"writes": ws})
        for w in ws:
            self.fake.routes[("POST", "writes/" + urllib.parse.quote(w["op_id"], safe=""))] = \
                (lambda b, o=w["op_id"]: (self.posts.__setitem__(o, b) or (204, None)))
        self.osync()
        self.assertEqual(self.posts, {"글감-1": {"result": "applied"}, "판-1": {"result": "applied"}})
        self.assertEqual(open(os.path.join(self.ont, "objects", "글감", "a1-첫글.md")).read(), "본")
        self.assertEqual(open(os.path.join(self.ont, "versions", "글감", "a1-첫글", "1.md")).read(), "지난")
        # objects/ 가 있어도 처음 생기는 하위 폴더(새 타입, 판 폴더)는 만든다
        self.write_op([{"op_id": "o2", "path": "objects/시리즈/s1.md", "base_sha256": None, "content": "s"},
                       {"op_id": "o3", "path": "versions/원고/b1-x/1.md", "base_sha256": None, "content": "v"}])
        self.assertEqual(self.posts, {"o2": {"result": "applied"}, "o3": {"result": "applied"}})
        # 깨진 심링크 폴더를 거쳐 밖으로 나가는 경로는 막는다
        outside = os.path.join(self.tmp.name, "outside2")
        os.symlink(os.path.join(outside, "gone"), os.path.join(self.ont, "objects", "dl"))
        self.write_op([{"op_id": "o4", "path": "objects/dl/x.md", "base_sha256": None, "content": "z"}])
        self.assertEqual(self.posts["o4"]["result"], "conflict")
        self.assertFalse(os.path.exists(outside))

    # ---- 묶음 설치 (P478-6) ----

    def serve(self, route, bundle, good=True):
        raw = json.dumps(bundle, ensure_ascii=False)
        sha = hashlib.sha256(raw.encode()).hexdigest()
        self.fake.routes[("GET", route)] = (200, {"version": bundle["version"], "sha256": sha if good else "0" * 64, "bundle": raw})

    def tree(self, d):
        out = {}
        for r, _, fs in os.walk(d):
            for f in fs:
                p = os.path.join(r, f)
                out[p] = open(p, "rb").read()
        return out

    def test_persona_bundle(self):
        self.connect()
        pd = os.path.join(self.root, "personas")
        os.makedirs(os.path.join(pd, "mine"))
        open(os.path.join(pd, "mine", "PROFILE.md"), "w").write("내 것")
        os.makedirs(os.path.join(pd, "rem"))
        open(os.path.join(pd, "rem", ".remote"), "w").write("{}")
        open(os.path.join(pd, "rem", "PROFILE.md"), "w").write("옛 판")
        b = {"version": "3", "personas": {"mine": {"PROFILE.md": "새"}, "rem": {"PROFILE.md": "새 판"},
                                           "fresh": {"PROFILE.md": "신규", "skills.md": "s"}}}
        self.serve("personas/bundle", b)
        r = self.run_remote("persona-install", "--root", self.root)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("REMOTE persona-skip mine", r.stdout)
        self.assertEqual(open(os.path.join(pd, "mine", "PROFILE.md")).read(), "내 것")
        self.assertEqual(open(os.path.join(pd, "rem", "PROFILE.md")).read(), "새 판")
        mark = json.load(open(os.path.join(pd, "fresh", ".remote")))
        self.assertEqual((mark["workspace_id"], mark["version"]), ("ws1", "3"))

    def test_persona_bundle_rejected(self):
        self.connect()
        base = {"version": "3", "personas": {"a": {"PROFILE.md": "x"}}}
        bad_paths = [{"a": {"../x": "x"}}, {"a": {"/etc/x": "x"}}, {"a": {"b/../../x": "x"}}, {"..": {"x": "x"}}]
        cases = [(base, False)] + [({"version": "3", "personas": p}, True) for p in bad_paths]
        for bundle, good in cases:
            self.serve("personas/bundle", bundle, good)
            r = self.run_remote("persona-install", "--root", self.root)
            self.assertEqual(r.returncode, 1, bundle)
            self.assertFalse(os.path.exists(os.path.join(self.root, "personas")), bundle)
            self.assertFalse(os.path.exists(os.path.join(self.root, "..", "x")))

    SCHEMA = {"version": "5", "files": {"object-types/글.md": "글 정의\n"},
              "schema_lines": ["| 글 | 한 줄 뜻 | [[글]] |", "| 인용한다 | 글 -> 글 | [[인용한다]] |"]}

    def test_schema_install(self):
        self.connect()
        ont = os.path.join(self.root, "ontology", "_ontology")
        os.makedirs(ont)
        open(os.path.join(ont, "SCHEMA.md"), "w").write("# 지도\n")
        self.serve("schema/bundle", self.SCHEMA)
        r = self.run_remote("schema-install", "--root", self.root)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(open(os.path.join(ont, "object-types", "글.md")).read(), "글 정의\n")
        self.assertIn("| 인용한다 | 글 -> 글 | [[인용한다]] |", open(os.path.join(ont, "SCHEMA.md")).read())
        logd = os.path.join(self.root, "ontology", "action-log")
        text = open(os.path.join(logd, os.listdir(logd)[0])).read()
        lines = [l for l in text.splitlines() if "스키마개정:" in l]
        self.assertEqual(len(lines), 2)
        self.assertIn("스키마개정: 인용한다(중량, 글 -> 글) - 원격 스키마 묶음 v5", text)
        self.run_remote("schema-install", "--root", self.root)  # 두 번째는 변화 없음
        self.assertEqual(open(os.path.join(logd, os.listdir(logd)[0])).read(), text)

    def test_schema_conflict_changes_nothing(self):
        self.connect()
        ont = os.path.join(self.root, "ontology", "_ontology")
        os.makedirs(os.path.join(ont, "object-types"))
        open(os.path.join(ont, "object-types", "글.md"), "w").write("다른 내용")
        open(os.path.join(ont, "SCHEMA.md"), "w").write("# 지도\n")
        bundle = dict(self.SCHEMA, files={"link-types/새.md": "n", "object-types/글.md": "글 정의\n"})
        self.serve("schema/bundle", bundle)
        before = self.tree(os.path.join(self.root, "ontology"))
        r = self.run_remote("schema-install", "--root", self.root)
        self.assertEqual(r.returncode, 2)
        self.assertIn("object-types/글.md", r.stderr)
        self.assertEqual(self.tree(os.path.join(self.root, "ontology")), before)

    def test_schema_rejects_bad_sha_and_dotdot(self):
        self.connect()
        ont = os.path.join(self.root, "ontology")
        self.serve("schema/bundle", self.SCHEMA, good=False)
        self.assertEqual(self.run_remote("schema-install", "--root", self.root).returncode, 1)
        self.serve("schema/bundle", dict(self.SCHEMA, files={"../../evil.md": "x"}))
        self.assertEqual(self.run_remote("schema-install", "--root", self.root).returncode, 1)
        self.assertFalse(os.path.exists(ont))


class WorkspaceRuntime(Base, unittest.TestCase):
    """P491-1: 런타임은 (컴퓨터, 워크스페이스)마다 하나다."""

    def setUp(self):
        super().setUp()
        spec = importlib.util.spec_from_file_location("remote", os.path.join(HERE, "remote.py"))
        self.m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.m)
        self.fake.routes[("POST", "runtimes/rt1/heartbeat")] = (200, {"ok": True})

    def new_root(self, name):
        r = os.path.join(self.tmp.name, name, ".dira")
        os.makedirs(os.path.join(r, "tickets"))
        return r

    def conn(self, root, *extra):
        return self.run_remote("connect", self.fake.url, "--root", root, *extra)

    def calls(self, method, path):
        return [c for c in self.fake.calls if c[0] == method and c[1] == path]

    def test_second_root_reuses_token(self):
        b = self.new_root("proj2")
        self.assertEqual(self.conn(self.root).returncode, 0)
        r = self.conn(b)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("이미 연결된 워크스페이스 ws1에"), r.stdout)
        self.assertEqual(len(self.calls("POST", "device/code")), 1)
        self.assertEqual(os.listdir(self.wsdir()).count("credentials.json"), 1)
        reg = self.calls("POST", "runtimes")[-1]
        self.assertEqual([p["project"] for p in reg[2]["projects"]], ["proj", "proj2"])
        self.assertEqual(reg[2]["project"], "proj2")
        self.assertEqual(reg[3], "Bearer tok-ws1")

    def test_conflicts_and_choice(self):
        self.assertEqual(self.conn(self.root).returncode, 0)
        dup = self.new_root(os.path.join("x", "proj"))
        r = self.conn(dup)
        self.assertEqual(r.returncode, 2)
        self.assertIn("같은 이름의 프로젝트가 이 워크스페이스에 이미 연결돼 있습니다: " + os.path.realpath(self.root), r.stderr)
        self.assertFalse(os.path.exists(os.path.join(dup, "remote.json")))
        # 워크스페이스가 둘이면 --workspace 없이는 rc 2
        c = self.new_root("c")
        self.fake.workspace, self.fake.token_polls = "ws2", 0
        self.fake.routes[("POST", "runtimes")] = (200, {"runtime_id": "rt2"})
        self.assertEqual(self.conn(c, "--new").returncode, 0)
        d = self.new_root("d")
        r = self.conn(d)
        self.assertEqual(r.returncode, 2)
        self.assertIn("ws1", r.stderr)
        self.assertIn("ws2", r.stderr)
        self.assertEqual(len(self.calls("POST", "device/code")), 2)
        self.assertEqual(self.conn(d, "--workspace", "ws1").returncode, 0)
        self.assertEqual(json.load(open(os.path.join(d, "remote.json")))["workspace_id"], "ws1")

    def test_new_deletes_old_runtime_after_register(self):
        self.assertEqual(self.conn(self.root).returncode, 0)
        b = self.new_root("proj2")
        self.fake.token_polls = 0
        self.fake.routes[("POST", "runtimes")] = (200, {"runtime_id": "rt9"})
        self.assertEqual(self.conn(b, "--new").returncode, 0)
        dels = self.calls("DELETE", "runtimes/rt1")
        self.assertEqual(len(dels), 1)
        self.assertEqual(json.load(open(os.path.join(self.wsdir(), "runtime.json")))["runtime_id"], "rt9")
        self.assertEqual(json.load(open(os.path.join(self.root, "remote.json")))["runtime_id"], "rt9")
        self.assertEqual(len(self.calls("POST", "runtimes")), 2)
        self.assertLess(self.fake.calls.index(self.calls("POST", "runtimes")[-1]), self.fake.calls.index(dels[0]))

    def test_signal_and_per_root_calls(self):
        eng = os.path.join(self.home, ".config", "dira", "bin", "engines")
        os.makedirs(eng)
        open(os.path.join(eng, "claude"), "w").write("#!/bin/sh\necho 1.0\n")
        os.chmod(os.path.join(eng, "claude"), 0o755)
        b = self.new_root("pro j2")
        self.fake.routes[("POST", "jobs/claim")] = (200, {"jobs": []})
        self.assertEqual(self.conn(self.root).returncode, 0)
        self.assertEqual(self.conn(b).returncode, 0)
        err = os.path.join(os.path.dirname(self.cred(root=b)), "last-error")
        open(err, "w").write("boom\n" + "x" * 900)
        for r in (self.root, b):
            os.makedirs(os.path.join(r, "ontology", "objects", "t"))
            open(os.path.join(r, "ontology", "objects", "t", "o.md"), "w").write("a")
            self.assertEqual(self.run_remote("sync", "--root", r).returncode, 0)
        t = time.time() + 3600  # 느린 실행에서도 루트 sync 간격 안으로 고정한다
        for d, _, fs in os.walk(self.wsdir()):
            if "last-sync" in fs:
                os.utime(os.path.join(d, "last-sync"), (t, t))
        self.assertEqual(self.run_remote("sync-all").returncode, 0)
        hb = self.calls("POST", "runtimes/rt1/heartbeat")[-1][2]
        self.assertEqual(set(hb), {"tools", "projects", "reads"})
        byname = {p["project"]: p for p in hb["projects"]}
        self.assertEqual(set(byname), {"proj", "pro j2"})
        self.assertNotIn("error", byname["proj"])
        self.assertTrue(byname["pro j2"]["error"].startswith("boom xxx"))
        self.assertLessEqual(len(byname["pro j2"]["error"]), 500)
        self.assertIn("workers", byname["proj"])
        import datetime
        for p in hb["projects"]:
            c = datetime.datetime.fromisoformat(p["next_claim_at"])
            self.assertIn(c.second, (0, 30))
            self.assertIsNotNone(c.utcoffset())
            self.assertLessEqual(abs(c.timestamp() - time.time()), 35)
        claims = [c[2]["project"] for c in self.calls("POST", "jobs/claim")]
        self.assertEqual(claims, ["proj", "pro j2"])
        paths = [c[1] for c in self.fake.calls]
        for p in ("proj", "pro%20j2"):
            for base in ("writes?runtime_id=rt1&project=", "answers?runtime_id=rt1&project="):
                self.assertIn(base + p, paths)

    def test_disconnect_last_root_releases_runtime(self):
        b = self.new_root("proj2")
        self.conn(self.root)
        self.conn(b)
        self.assertEqual(self.run_remote("disconnect", "--root", b).returncode, 0)
        self.assertEqual(self.calls("DELETE", "runtimes/rt1"), [])
        self.assertTrue(os.path.exists(self.cred()))
        self.assertTrue(os.path.exists(os.path.join(self.root, "remote.json")))
        self.assertEqual([p["project"] for p in self.m_list()], ["proj"])
        self.assertEqual(self.run_remote("disconnect", "--root", self.root).returncode, 0)
        self.assertEqual(len(self.calls("DELETE", "runtimes/rt1")), 1)
        self.assertFalse(os.path.exists(os.path.join(self.wsdir(), "runtime.json")))
        self.assertFalse(os.path.exists(self.wscred()))

    def m_list(self):
        with mock.patch.dict(os.environ, {"HOME": self.home}):
            return self.m.list_projects("ws1")

    # ---- P491-2: 컴퓨터 시계 ----

    def expire(self):
        """10초 신호 간격과 루트 sync 간격을 건너뛴다."""
        base = os.path.join(self.wsdir())
        p = os.path.join(base, "last-heartbeat")
        if os.path.exists(p):
            os.utime(p, (1, 1))
        for d, _, fs in os.walk(base):
            if "last-sync" in fs:
                os.utime(os.path.join(d, "last-sync"), (1, 1))

    def two_roots(self):
        eng = os.path.join(self.home, ".config", "dira", "bin", "engines")
        os.makedirs(eng)
        with open(os.path.join(eng, "claude"), "w") as f:
            f.write("#!/bin/sh\necho 1.0\n")
        os.chmod(os.path.join(eng, "claude"), 0o755)
        b = self.new_root("proj2")
        self.fake.routes[("POST", "jobs/claim")] = (200, {"jobs": []})
        self.assertEqual(self.conn(self.root).returncode, 0)
        self.assertEqual(self.conn(b).returncode, 0)
        return b

    def test_sync_all_one_heartbeat_with_both_projects(self):
        b = self.two_roots()
        n = len(self.calls("POST", "runtimes/rt1/heartbeat"))
        r = self.run_remote("sync-all")
        self.assertEqual(r.returncode, 0, r.stderr)
        hbs = self.calls("POST", "runtimes/rt1/heartbeat")
        self.assertEqual(len(hbs) - n, 1)
        self.assertEqual(sorted(p["project"] for p in hbs[-1][2]["projects"]), ["proj", "proj2"])
        self.assertEqual(len(self.calls("POST", "jobs/claim")), 2)
        stamp = os.path.join(self.wsdir(), "last-heartbeat")
        t = time.time() + 3600  # 시간에 기대지 않고 방금 보낸 것으로 고정한다
        os.utime(stamp, (t, t))
        self.run_remote("sync-all")  # 신호 간격 안 - 신호는 건너뛴다
        self.assertEqual(len(self.calls("POST", "runtimes/rt1/heartbeat")) - n, 1)

    def test_failing_root_gets_error_and_does_not_block_other(self):
        b = self.two_roots()
        self.run_remote("sync-all")
        shutil.rmtree(os.path.join(b, "tickets"))  # B의 sync가 예외를 낸다
        self.expire()
        self.run_remote("sync-all")
        err = os.path.join(os.path.dirname(self.cred(root=b)), "last-error")
        self.assertIn("FileNotFoundError", open(err).read())
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.cred()), "last-error")))
        claims = len(self.calls("POST", "jobs/claim"))
        self.assertEqual(claims, 3)  # A는 두 번, B는 첫 번만
        self.expire()
        self.run_remote("sync-all")
        by = {p["project"]: p for p in self.calls("POST", "runtimes/rt1/heartbeat")[-1][2]["projects"]}
        self.assertIn("error", by["proj2"])
        self.assertNotIn("error", by["proj"])
        os.makedirs(os.path.join(b, "tickets"))  # 고치면 error가 사라진다
        self.expire()
        self.run_remote("sync-all")
        self.assertFalse(os.path.exists(err))

    def test_child_timeout_kills_and_records(self):
        b = self.two_roots()
        self.fake.routes[("GET", "writes?runtime_id=rt1&project=proj2")] = lambda body: (time.sleep(15), (200, {"writes": []}))[1]
        self.expire()
        env = dict(os.environ, HOME=self.home, DIRA_CRONTAB_FILE=self.cron, DIRA_SYNC_TIMEOUT="1")
        t0 = time.time()
        subprocess.run([sys.executable, os.path.join(HERE, "remote.py"), "sync-all"], env=env,
                       capture_output=True, text=True, timeout=30)
        self.assertLess(time.time() - t0, 12)
        err = os.path.join(os.path.dirname(self.cred(root=b)), "last-error")
        self.assertEqual(open(err).read().strip(), "timeout")

    def test_tick_places_clock_once_and_last_disconnect_removes_it(self):
        self.assertEqual(self.conn(self.root).returncode, 0)
        sa = lambda: len([l for l in open(self.cron) if "sync-all" in l])
        self.assertEqual(sa(), 2)  # connect도 넣는다
        os.unlink(self.cron)
        for _ in range(2):
            self.assertEqual(self.run_remote("tick", "--root", self.root).returncode, 0)
        self.assertEqual(sa(), 2)
        self.assertIn('python3 "%s" sync-all' % os.path.join(self.engdir, "remote.py"), open(self.cron).read())
        self.assertEqual(self.run_remote("disconnect", "--root", self.root).returncode, 0)
        self.assertEqual(sa(), 0)

    def test_tick_without_clock_falls_back_to_sync_all(self):
        self.two_roots()
        n = len(self.calls("POST", "runtimes/rt1/heartbeat"))
        os.chmod(self.cron, 0o444)
        self.assertEqual(self.run_remote("tick", "--root", self.root).returncode, 0)  # 줄이 이미 있어 sync만
        self.assertEqual(len(self.calls("POST", "runtimes/rt1/heartbeat")) - n, 0)
        os.chmod(self.cron, 0o644)
        os.unlink(self.cron)
        os.mkdir(self.cron)  # 파일로 못 쓰니 줄을 못 넣는다
        self.expire()
        self.run_remote("tick", "--root", self.root)
        self.assertEqual(len(self.calls("POST", "runtimes/rt1/heartbeat")) - n, 1)

    # ---- 옛 배치 합치기 ----

    def legacy_root(self, name, rid, tok, age, p485=True):
        r = self.new_root(name)
        json.dump({"server": self.fake.url, "workspace_id": "ws1", "runtime_id": rid, "project": name},
                  open(os.path.join(r, "remote.json"), "w"))
        rd = os.path.join(self.wsdir(), "roots", hashlib.sha256(os.path.realpath(r).encode()).hexdigest()[:16])
        os.makedirs(rd)
        json.dump({"runtime_token": tok, "root": os.path.realpath(r)}, open(os.path.join(rd, "credentials.json"), "w"))
        open(os.path.join(rd, "last-sync"), "w").write("1")
        os.utime(os.path.join(rd, "last-sync"), (age, age))
        return r

    def merge(self):
        with mock.patch.dict(os.environ, {"HOME": self.home}):
            self.m.merge_all()

    def test_merge_p485_layout(self):
        a = self.legacy_root("pa", "rtA", "tok-A", 2000)
        b = self.legacy_root("pb", "rtB", "tok-B", 1000)
        self.fake.routes[("POST", "runtimes/rtA/heartbeat")] = (401, None)
        self.fake.routes[("POST", "runtimes/rtB/heartbeat")] = (200, {"ok": True})
        self.fake.routes[("DELETE", "runtimes/rtA")] = (204, None)
        self.merge()
        self.assertEqual(json.load(open(os.path.join(self.wsdir(), "runtime.json")))["runtime_id"], "rtB")
        self.assertEqual(json.load(open(self.wscred())), {"runtime_token": "tok-B"})
        dels = self.calls("DELETE", "runtimes/rtA")
        self.assertEqual(len(dels), 1)
        self.assertEqual(dels[0][3], "Bearer tok-A")
        for r in (a, b):
            self.assertEqual(json.load(open(os.path.join(r, "remote.json")))["runtime_id"], "rtB")
        self.assertEqual(sorted(p["project"] for p in self.m_list()), ["pa", "pb"])
        self.assertEqual(self.calls("DELETE", "runtimes/rtB"), [])
        n = len(self.fake.calls)
        self.merge()
        self.assertEqual(len(self.fake.calls), n)

    def test_merge_all_unauthorized_changes_nothing(self):
        self.legacy_root("pa", "rtA", "tok-A", 2000)
        self.fake.routes[("POST", "runtimes/rtA/heartbeat")] = (401, None)
        self.merge()
        self.assertFalse(os.path.exists(os.path.join(self.wsdir(), "runtime.json")))
        self.assertEqual(self.m_list(), [])

    def test_merge_pre_p485_layout(self):
        r = self.new_root("pa")
        json.dump({"server": self.fake.url, "workspace_id": "ws1", "runtime_id": "rt1", "project": "pa"},
                  open(os.path.join(r, "remote.json"), "w"))
        os.makedirs(self.wsdir())
        json.dump({"runtime_token": "tok-old", "root": os.path.realpath(r)}, open(self.wscred(), "w"))
        open(os.path.join(self.wsdir(), "manifest.json"), "w").write("{}")
        self.merge()
        self.assertEqual(json.load(open(os.path.join(self.wsdir(), "runtime.json")))["runtime_id"], "rt1")
        self.assertEqual(json.load(open(self.wscred())), {"runtime_token": "tok-old"})
        self.assertEqual([p["project"] for p in self.m_list()], ["pa"])
        self.assertTrue(os.path.exists(os.path.join(os.path.dirname(self.cred(root=r)), "manifest.json")))
        self.assertFalse(os.path.exists(os.path.join(self.wsdir(), "manifest.json")))


class Wake(Base, unittest.TestCase):
    """P497-1: sync --now - --report, run_now, 읽기 응답의 wake 처리."""
    setup_jobs = T.setup_jobs
    job = T.job
    tickets = T.tickets

    def wake_setup(self, wake_for_call, jobs_after_wake=True):
        """wake_for_call(n) -> 읽기 n번째 응답의 wake 목록."""
        self.setup_jobs([])
        self.woke = False
        self.claim_times, self.read_times = [], []
        calls = {"n": 0}

        def reads(_b):
            calls["n"] += 1
            self.read_times.append(time.time())
            w = wake_for_call(calls["n"])
            if w:
                self.woke = True
            return 200, ({"reads": [], "wake": w} if w else {"reads": []})

        def claim(_b):
            self.claim_times.append(time.time())
            return 200, {"jobs": [self.job()] if self.woke and not self.tickets() else []}
        self.fake.routes[("GET", "reads")] = reads
        self.fake.routes[("POST", "jobs/claim")] = claim
        self.fake.routes[("POST", "runtimes/rt1/heartbeat")] = (200, {"ok": True})

    def sync_all(self, secs):
        os.environ["DIRA_READ_DEADLINE"] = str(time.time() + secs)
        self.addCleanup(os.environ.pop, "DIRA_READ_DEADLINE", None)
        r = self.run_remote("sync-all")
        self.assertEqual(r.returncode, 0, r.stderr)
        return r

    def test_wake_runs_sync_within_interval_and_claims(self):
        self.wake_setup(lambda n: [{"project": "proj", "kinds": ["jobs"]}] if n == 1 else None)
        r = self.sync_all(24)  # 직전 run_child sync가 방금 돌았어도(10초 간격 안) 깨우기는 돈다
        self.assertIn("REMOTE wake proj jobs", r.stdout)
        self.assertEqual(len(self.tickets()), 1)
        self.assertTrue(any("wake=1" in c[1] for c in self.fake.calls if c[1].startswith("reads?")))
        first_read = self.read_times[0]
        # 수용조건은 3초 - 자식 sync 시작이 느린 환경을 감안해 넉넉히 둔다
        self.assertTrue([t for t in self.claim_times if 0 <= t - first_read < 6], (self.claim_times, first_read))

    def test_wake_same_root_at_most_every_2s(self):
        self.wake_setup(lambda n: [{"project": "proj", "kinds": ["writes"]}])
        r = self.sync_all(24)
        n = r.stdout.count("REMOTE wake proj writes")
        self.assertGreaterEqual(n, 2, r.stdout)
        self.assertLessEqual(n, 8, r.stdout)  # 긴 대기 약 10초 / 2초

    def test_wake_unknown_project_skipped_and_no_wake_is_plain(self):
        self.wake_setup(lambda n: [{"project": "nope", "kinds": ["jobs"]}] if n == 1 else None)
        r = self.sync_all(24)
        self.assertIn("REMOTE wake-skip nope", r.stdout)
        self.assertNotIn("REMOTE wake proj", r.stdout)
        self.assertEqual(self.tickets(), [])
        self.assertEqual(len([t for t in self.claim_times]), 1)  # run_child sync의 한 번뿐

    def test_now_lock_conflict_rc75_no_last_error(self):
        self.connect()
        os.mkdir(os.path.join(self.root, ".remote-sync.lock"))
        for flag in ("--now", "--report"):
            self.assertEqual(self.run_remote("sync", "--root", self.root, flag).returncode, 75)
        self.assertEqual(self.run_remote("sync", "--root", self.root).returncode, 0)  # 플래그 없으면 rc 0
        import importlib.util
        spec = importlib.util.spec_from_file_location("remote_t", os.path.join(self.engdir, "remote.py"))
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        old = os.environ.get("HOME")
        os.environ["HOME"] = self.home
        try:
            self.assertIs(m.run_now("ws1", self.root, "--now"), False)
        finally:
            os.environ["HOME"] = old
        self.assertFalse(os.path.exists(os.path.join(os.path.dirname(self.cred()), "last-error")))

    def test_report_runs_only_report_steps_and_keeps_stamp(self):
        self.setup_jobs([[self.job()]])
        stamp = os.path.join(os.path.dirname(self.cred()), "last-sync")
        r = self.run_remote("sync", "--root", self.root)
        self.assertEqual(r.returncode, 0, r.stderr)
        h = self.tickets()[0][:-3]
        os.rename(os.path.join(self.root, "tickets", h + ".md"), os.path.join(self.root, "tickets", h + ".wip.md"))
        os.utime(stamp, (1, 1))
        before = os.stat(stamp).st_mtime
        n = len(self.fake.calls)
        r = self.run_remote("sync", "--root", self.root, "--report")
        self.assertEqual(r.returncode, 0, r.stderr)
        paths = [c[1].split("?")[0] for c in self.fake.calls[n:]]
        self.assertIn("jobs/J1/status", paths)  # 보고는 돈다
        for bad in ("jobs/claim", "writes", "answers"):
            self.assertNotIn(bad, paths)
        self.assertEqual(os.stat(stamp).st_mtime, before)


class Watch(Base, unittest.TestCase):
    """P497-2: 긴 대기 중 감시 스레드가 원격 작업 티켓 변화를 바로 보고한다."""
    setup_jobs = T.setup_jobs
    job = T.job
    tickets = T.tickets
    wip_job = T.wip_job
    sync = T.sync

    def start(self, reads_ok):
        tdir, h, p = self.wip_job()
        self.fake.routes[("POST", "runtimes/rt1/heartbeat")] = (200, {"ok": True})
        if reads_ok:
            self.fake.routes[("GET", "reads")] = (200, {"reads": []})
        self.times = {}
        for key, route in (("status", "jobs/J1/status"), ("events", "jobs/J1/events")):
            self.fake.routes[("POST", route)] = (lambda k: lambda b: (
                self.times.setdefault(k, []).append((time.time(), b)) or (204, None)))(key)
        self.claims = 0

        def claim(_b):
            self.claims += 1
            return 200, {"jobs": []}
        self.fake.routes[("POST", "jobs/claim")] = claim
        env = dict(os.environ, HOME=self.home, DIRA_CRONTAB_FILE=self.cron,
                   DIRA_READ_DEADLINE=str(time.time() + 40))
        env.pop("TICKET_ONTOLOGY", None)
        self.proc = subprocess.Popen([sys.executable, os.path.join(self.engdir, "remote.py"), "sync-all"],
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        self.addCleanup(lambda: (self.proc.kill(), self.proc.wait(), time.sleep(3)))  # 자식 sync가 끝난 뒤 임시 디렉터리를 지운다
        end = time.time() + 30
        while not [c for c in self.fake.calls if c[1].startswith("reads?")]:  # 긴 대기가 시작됐다 - 감시 스레드도 같이 뜬다
            self.assertLess(time.time(), end)
            time.sleep(0.2)
        time.sleep(1)  # 기준 서명을 잰다
        self.claims0 = self.claims
        return tdir, h, p

    def waitfor(self, key, secs):
        end = time.time() + secs
        while time.time() < end and not self.times.get(key):
            time.sleep(0.1)

    def done_flow(self, reads_ok):
        tdir, h, p = self.start(reads_ok)
        t0 = time.time()
        os.rename(p, os.path.join(tdir, h + ".done.md"))
        self.waitfor("status", 10)
        got = self.times.get("status")
        self.assertTrue(got, "status 보고가 안 왔다")
        self.assertEqual(got[0][1]["state"], "done")
        self.assertLess(got[0][0] - t0, 6)  # 수용조건은 3초 - 자식 sync 시작이 느린 환경을 감안해 넉넉히 둔다
        self.assertEqual(self.claims, self.claims0)  # 바로 보고는 작업을 다시 잡지 않는다

    def test_done_rename_reported_fast_without_claim(self):
        self.done_flow(True)

    def test_watch_runs_when_reads_404(self):
        self.done_flow(False)

    def test_log_growth_reported_and_rate_limited(self):
        tdir, h, p = self.start(True)
        logs = os.path.join(self.root, "workers", "logs")
        os.makedirs(logs, exist_ok=True)
        lp = os.path.join(logs, "20261011-000000-w1-%s.log" % h)
        t0 = time.time()
        for i in range(8):  # 1초마다 다른 Bash 명령 - 줄마다 이벤트가 된다
            with open(lp, "a") as f:
                f.write(json.dumps({"type": "assistant", "message": {"content": [
                    {"type": "tool_use", "name": "Bash", "input": {"command": "echo %d" % i}}]}}) + "\n")
            if i == 0:
                self.waitfor("events", 8)
                self.assertTrue(self.times.get("events"), "events 보고가 안 왔다")
                self.assertLess(self.times["events"][0][0] - t0, 8)  # 수용조건은 6초
            else:
                time.sleep(1)
        out, _ = self.proc.communicate(timeout=60)
        n = out.count("REMOTE report-now proj")
        self.assertGreaterEqual(n, 1, out)
        self.assertLessEqual(n, 3, out)  # 약 8초 동안 5초에 한 번


if __name__ == "__main__":
    unittest.main()
