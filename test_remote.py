#!/usr/bin/env python3
"""remote.py 테스트. http.server 가짜 서버를 세운다 - 뒤 장들이 이 서버에 라우트를 더한다."""
import importlib.util
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


class Base:
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
        env.pop("TICKET_ONTOLOGY", None)
        return subprocess.run([sys.executable, os.path.join(HERE, "remote.py"), *args],
                              capture_output=True, text=True, env=env, timeout=30)

    def connect(self):
        return self.run_remote("connect", self.fake.url, "--root", self.root)

    def cred(self, ws="ws1"):
        return os.path.join(self.home, ".config", "dira", "remote", ws, "credentials.json")


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

    # ---- P478-3: 작업 잡기-상태 보고-작업 토큰 ----

    def sync(self):
        stamp = os.path.join(os.path.dirname(self.cred()), "last-sync")
        if os.path.exists(stamp):
            os.utime(stamp, (1, 1))  # 10초 간격을 건너뛴다
        r = self.run_remote("sync", "--root", self.root)
        self.assertEqual(r.returncode, 0, r.stderr)
        return r

    def setup_jobs(self, jobs):
        self.connect()
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

    def test_failed_and_awaiting(self):
        self.setup_jobs([[self.job()]])
        self.sync()
        tdir = os.path.join(self.root, "tickets")
        h = self.tickets()[0][:-3]
        p = os.path.join(tdir, h + ".wip.md")
        os.rename(os.path.join(tdir, h + ".md"), p)
        text = open(p).read()
        open(p, "w").write(text.replace("remote_job: J1", "remote_job: J1\nawaiting: abcd1234"))
        self.sync()
        self.assertEqual(self.statuses(), ["awaiting"])
        open(os.path.join(tdir, "abcd1234.done.md"), "w").write("x")
        self.sync()
        self.assertEqual(self.statuses(), ["awaiting", "running"])
        open(p, "a").write("\n## 블록\n막힘\n")
        self.sync()
        self.assertEqual(self.statuses(), ["awaiting", "running", "failed"])
        tok = os.path.join(self.home, ".config", "dira", "run", "remote-jobs", h + ".json")
        self.assertFalse(os.path.exists(tok))

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
        self.fake.routes[("GET", "answers?runtime_id=rt1")] = (200, {"answers": [ans]})
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
        self.fake.routes[("GET", "answers?runtime_id=rt1")] = (200, {"answers": bad})
        self.sync()
        self.assertEqual([n for n in os.listdir(tdir) if "answer" in n or n.startswith("ffff")], [])
        self.assertFalse(os.path.exists(os.path.join(self.root, "evil.done.md")))


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
        self.run_remote("sync", "--root", self.root)
        w = {x["name"]: x for x in self.hb()["workers"]}
        self.assertEqual(w["w2"]["busy"], "abcd1234")
        self.assertIsNone(w["w1"]["busy"])
        import datetime
        t = datetime.datetime.fromisoformat(w["w1"]["next_dispatch_at"])
        self.assertIn(t.second, (0, 30))
        self.assertIsNotNone(t.utcoffset())

    def test_login_check_schedule(self):
        self.connect()
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

    # ---- 온톨로지 올리기-원격 쓰기 ----
    def ont_setup(self):
        self.connect()
        self.ont = os.path.join(self.root, "ontology")
        os.makedirs(os.path.join(self.ont, "objects", "t"))
        self.puts = []
        self.fake.routes[("PUT", "objects")] = lambda b: (self.puts.append(b) or (204, None))
        self.stamp = os.path.join(os.path.dirname(self.cred()), "last-sync")

    def osync(self):
        if os.path.exists(self.stamp):
            os.utime(self.stamp, (1, 1))
        r = self.run_remote("sync", "--root", self.root)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertNotIn("Error", r.stdout)

    def test_push_changed_and_deleted_and_batch(self):
        self.ont_setup()
        for i in range(201):
            open(os.path.join(self.ont, "objects", "t", "o%03d.md" % i), "w").write("a%d" % i)
        self.osync()
        self.assertEqual(len(self.puts[0]["changes"]), 200)
        self.osync()
        self.assertEqual(len(self.puts[1]["changes"]), 1)
        self.osync()
        self.assertEqual(len(self.puts), 2)
        open(os.path.join(self.ont, "objects", "t", "o000.md"), "w").write("edited")
        self.osync()
        self.assertEqual([c["path"] for c in self.puts[2]["changes"]], ["objects/t/o000.md"])
        self.assertEqual(self.puts[2]["changes"][0]["content"], "edited")
        os.unlink(os.path.join(self.ont, "objects", "t", "o000.md"))
        self.osync()
        self.assertEqual(self.puts[3]["changes"], [{"path": "objects/t/o000.md", "deleted": True}])

    def write_op(self, writes):
        self.posts = {}
        self.fake.routes[("GET", "writes?runtime_id=rt1")] = (200, {"writes": writes})
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


if __name__ == "__main__":
    unittest.main()
