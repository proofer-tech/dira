#!/usr/bin/env python3
"""페르소나별 동시 워커 상한 자체검증 (docs/DESIGN.md §5-4): 상한 n의 페르소나가 워커를
n개 넘게 쥐는 창이 있는가.

2026-08-04 실측이 요구를 낳았다 - `workers/runner.log` DISPATCH 3,905건 전량 replay에서
페르소나별 **동시 진행 최댓값**이 pm 7 · developer 6 · archive-manager 6이고 워커는 8개다.
한 페르소나가 워커 전부를 쥐는 창이 실제로 있었다.

**이 테스트의 본문은 ④다.** 상한을 세고 나서 잡으면 상한이 아니다 - 워커 8개는 cron 같은 분에
뜨고 같은 1초에 최대 5개가 DISPATCH된다(실측 1초 창 분포: 1개 1,322초 · … · 5개 33). 상한 1의
티켓이 다섯 장 열려 있으면 다섯 워커가 모두 `0 < 1`을 읽고 각자 다른 티켓을 잡는데, **로그에는
아무 이상이 안 남는다**. 그래서 ④는 **소박한 카운트 대조군**(한 판에 한 번 세고 그 수로 후보를
훑는 판 · 임계구역 없음)을 같이 돈다 - 대조군이 1장을 내면 다섯 워커가 같은 창에 안 들어갔다는
뜻이고 그때 ④는 공허하다.

세는 단위는 `.wip` 하나다(보드가 세는 수와 같은 수). 그래서 손 claim도 같이 센다(⑤).
잘못 쓴 값은 `0`이 아니라 **상한 없음**으로 떨어진다(③) - 오타 하나가 페르소나를 영구히
굶기면 안 된다. 양끝 공백·후행 개행은 값이 아니다(②) - 화면이 쓰는 사이드카는 전부 끝에
`\\n`이 붙는다.

진짜 claude를 부르지 않는다 - 프롬프트를 받아 적고 result 한 줄을 뱉은 뒤 스스로는 안 끝나는
가짜 스트림 엔진으로 판정한다(도그푸딩으로 안 잰다 - DESIGN.md §제약 1).
실패하면 assert로 죽는다.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")
PY = os.path.join(HERE, "tickets.py")

WORKER = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/fake-engine.sh" "{{sid}}" "--input-format" "stream-json")
. "{tick}"
"""

# 가짜 스트림 엔진. 이 테스트가 재는 것은 claim이라 갈래가 하나다 - 정상 완료.
# `result`가 **마지막 줄**이어야 감시자(is_result)가 세션을 죽인다. `exec`도 필수다 -
# 없으면 bash 래퍼 + 자식 sleep이 되어 고아 sleep이 워커 stdout을 60초 쥔다(test_feed_stall.py).
# 세션은 티켓 상태를 안 바꾼다(그건 사람·에이전트의 일이다) - 그래서 tick이 끝나면 `.wip`이
# 그대로 남고, 그 수가 이 테스트가 세는 값이다.
ENGINE = """\
#!/bin/bash
IFS= read -r _first
printf '{{"type":"system","subtype":"init"}}\\n'
printf '{{"is_error":false,"num_turns":1,"session_id":"%s","type":"result","subtype":"success"}}\\n' "$1"
exec sleep 60
"""

TICKET = "---\nticket: {h}\ntitle: t\nkind: work\npersona: {p}\n---\n\n## Goal\ntest\n"

# ⑦ 큐 무수정: 이 개정은 티켓 파일에 한 줄도 안 닿는다. 아래는 **이 개정 전부터** 엔진이 쓰던
# 키뿐이다(assign·setpid·setinbox·handclaim·reap·ask_human) + 픽스처가 쓴 넷.
ALLOWED_FM = {"ticket", "title", "kind", "persona",
              "session_id", "assigned_at", "owner", "pid", "inbox",
              "claimed_at", "transcript", "attempts", "deps", "awaiting"}
# 새 로그 낱말 0: 상한에 걸려 안 뜨는 것은 SKIP이고 잠금 회수는 종전 WARN이다.
ALLOWED_LOG = {"SKIP", "WARN", "NOTE", "ERROR", "DISPATCH", "DONE", "FAIL", "STALL",
               "TIMEOUT", "KILLED", "REAP", "REAP-FAIL", "ASK", "ASK-FAIL", "SUSPECT",
               "AUTH", "UNASSIGN", "UNASSIGN-DENY", "UNASSIGN-FORCE"}
LOGLINE = re.compile(r"^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d \[[^]]*\] (\S+)")


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


tmp = os.path.realpath(tempfile.mkdtemp())
audited = [0]
try:
    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    tdir = os.path.join(root, "tickets")
    runlog = os.path.join(root, "workers", "runner.log")
    slock = os.path.join(local, "run", "select.lock")
    env = dict(os.environ, TICKET_LOCAL=local)

    mkfile(os.path.join(tmp, "fake-engine.sh"), ENGINE.format(tmp=tmp), 0o755)
    WS = {}
    for n in ("w1", "w2", "w3", "w4", "w5"):
        WS[n] = mkfile(os.path.join(root, "workers", n + ".sh"),
                       WORKER.format(name=n, tmp=tmp, tick=TICK), 0o755)
    for p in ("pm", "developer"):
        mkfile(os.path.join(root, "personas", p, "PROFILE.md"), "# " + p + "\n")

    def limit(persona, body):
        """`personas/<이름>/limit`을 쓴다. body=None이면 지운다(= 상한 없음, 기본값)."""
        f = os.path.join(root, "personas", persona, "limit")
        if body is None:
            if os.path.exists(f):
                os.remove(f)
        else:
            mkfile(f, body)

    def audit():
        """⑦ 큐 무수정 - 지금 큐에 있는 티켓 전부의 frontmatter 키와 상태 접미사를 본다.
        큐를 다시 세우기 직전에 부르므로 판마다 쌓인 것을 한 번씩 다 본다."""
        for f in sorted(os.listdir(tdir)):
            audited[0] += 1
            assert (re.match(r"^[0-9a-z]{8}\.md$", f)
                    or re.match(r"^[0-9a-z]{8}\.(wip|done)\.md$", f)), \
                "상태 접미사가 3종이 아니다: " + f
            with open(os.path.join(tdir, f), encoding="utf-8") as fh:
                lines = fh.read().split("\n")
            assert lines[0] == "---", "frontmatter가 깨졌다: " + f
            for line in lines[1:]:
                if line.strip() == "---":
                    break
                m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*):", line)
                assert not m or m.group(1) in ALLOWED_FM, \
                    "새 frontmatter 키가 생겼다: {} ({})".format(m.group(1), f)

    def queue(open_=(), wip=()):
        """큐를 원하는 모양으로 다시 세운다. `wip`은 손 claim 모양(session_id도 pid도 없다)이라
        reap이 두 번 다시 보지 않는다 - 테스트가 몇 분을 돌아도 픽스처가 안 흔들린다."""
        if os.path.isdir(tdir):
            audit()
            shutil.rmtree(tdir)
        os.makedirs(tdir)
        for h, p in open_:
            mkfile(os.path.join(tdir, h + ".md"), TICKET.format(h=h, p=p))
        for h, p in wip:
            mkfile(os.path.join(tdir, h + ".wip.md"), TICKET.format(h=h, p=p))

    def log():
        try:
            with open(runlog, encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    def wips():
        return sorted(f for f in os.listdir(tdir) if f.endswith(".wip.md"))

    def tick(name="w1", **over):
        r = subprocess.run([WS[name], "tick"], capture_output=True, text=True,
                           env=dict(env, **over), timeout=180)
        assert r.returncode == 0, "{} tick rc={}\n{}".format(name, r.returncode, r.stderr)
        return r

    # --- ① 상한 미달: 종전대로 뜬다 (limit=2, .wip 1장) ---
    limit("pm", "2\n")
    queue(open_=[("aaaa0001", "pm")], wip=[("wwww0001", "pm")])
    before = len(log())
    tick()
    added = log()[before:]
    assert "DISPATCH aaaa0001" in added, "상한 미달인데 안 떴다:\n" + added
    assert "SKIP 페르소나 상한" not in added, "미달인데 상한이 막았다:\n" + added
    assert wips() == ["aaaa0001.wip.md", "wwww0001.wip.md"], wips()

    # --- ② 상한 도달: 그 페르소나만 SKIP, 다른 페르소나는 그대로 뜬다(굶기지 않는다) ---
    # 세 모양을 같이 잰다 - `2\n` · ` 2 ` · `2\n\n`이 전부 정수 2다. SKIP 줄이 읽은 값을
    # `2/2`로 찍으므로 이 한 줄이 파싱 결과를 그대로 보여 준다(양끝 공백은 값이 아니다).
    for form in ("2\n", " 2 ", "2\n\n"):
        limit("pm", form)
        queue(open_=[("aaaa0002", "pm"), ("bbbb0002", "developer")],
              wip=[("wwww0001", "pm"), ("wwww0002", "pm")])
        before = len(log())
        tick()
        added = log()[before:]
        assert added.count("SKIP 페르소나 상한 pm 2/2") == 1, \
            "{!r}을 정수 2로 안 읽었다:\n{}".format(form, added)
        assert "WARN 페르소나 상한이 정수가 아니다" not in added, \
            "{!r}을 정수가 아닌 값으로 읽었다:\n{}".format(form, added)
        assert "DISPATCH bbbb0002" in added, \
            "pm이 상한이라고 developer까지 굶겼다:\n" + added
        assert "aaaa0002.wip.md" not in wips(), "상한 도달인데 claim했다: " + str(wips())

    # --- ③ `0` = 일시 정지 / 없음·빈 파일·정수 아님 = 상한 없음 ---
    # `0`은 .wip이 0장이어도 안 뜬다(`count < 0`이 늘 거짓이라 공짜로 따라온다).
    limit("pm", "0\n")
    queue(open_=[("aaaa0003", "pm")])
    before = len(log())
    tick()
    added = log()[before:]
    assert added.count("SKIP 페르소나 상한 pm 0/0") == 1, "0이 안 막았다:\n" + added
    assert "DISPATCH" not in added, "0인데 디스패치했다:\n" + added
    assert wips() == [], wips()

    # 잘못 쓴 값이 떨어지는 방향은 `상한 없음`이다 - `abc`는 WARN 한 줄을 남기고 그대로 돈다.
    for body, warns in ((None, 0), ("", 0), ("abc\n", 1)):
        limit("pm", body)
        queue(open_=[("aaaa0004", "pm")],
              wip=[("wwww0001", "pm"), ("wwww0002", "pm"), ("wwww0003", "pm")])
        before = len(log())
        tick()
        added = log()[before:]
        assert "DISPATCH aaaa0004" in added, \
            "limit={!r}은 상한 없음이어야 한다:\n{}".format(body, added)
        assert "SKIP 페르소나 상한" not in added, \
            "limit={!r}이 상한으로 읽혔다:\n{}".format(body, added)
        assert added.count("WARN 페르소나 상한이 정수가 아니다") == warns, \
            "limit={!r}의 WARN이 {}줄이 아니다:\n{}".format(body, warns, added)

    # --- ④ 동시 claim (이 요구의 본문) ---
    # limit=1, 같은 페르소나 열린 티켓 5장, 워커 5개를 같은 순간에 띄운다.
    #
    # 대조군은 **소박한 카운트**다 - 한 판에 한 번 세고 그 수로 후보를 훑는(= 카운트가 claim보다
    # 앞인) 판. 그것이 스펙이 말하는 `잠금 없이 같은 판`이고, 그 판이 5장을 잡는 것이 이 요구의
    # 근거 전부다. 대조군을 안 돌리면 ④는 공허하다 - 다섯 워커가 애초에 같은 창에 안 들어갔어도
    # `.wip`은 1장이 나온다.
    # 대조군은 tick.sh 사본에 **한 줄을 갈아** 만든다(운영 코드에 테스트 훅을 안 심는다):
    # 카운트를 파일에 캐시해서 한 판에 한 번만 세게 한다. 임계구역은 워커마다 다른
    # TICKET_LOCAL을 줘서 없앤다(머신에 하나이던 잠금이 워커별이 되면 아무도 안 막는다).
    naive_dir = os.path.join(tmp, "naive")
    os.makedirs(naive_dir)
    os.symlink(PY, os.path.join(naive_dir, "tickets.py"))
    os.symlink(os.path.join(HERE, "protocols"), os.path.join(naive_dir, "protocols"))
    with open(TICK, encoding="utf-8") as f:
        src = f.read()
    # `sleep 3`은 세는 것과 잡는 것 사이의 창을 넓혀 대조군을 결정적으로 만든다. 운영의 창은
    # cron이 워커 8개를 같은 분에 깨우는 1초짜리이고 그 안에서 DISPATCH 5개가 실제로 났다(실측).
    # 여기서 그보다 크게 잡는 이유는 기동 지터다 - 워커 하나가 세기까지 python3를 다섯 번 띄우고
    # (락 해시·reap·지문·select·카운트) 다섯이 겹치면 그 앞머리만 1초 넘게 흩어진다.
    # 안 넓혀도 상한은 깨진다(실측: 1초 창 2장 · 창 없이 2장). 넓히면 스펙이 적은 5장이 그대로 난다.
    CALL = '      PWIP=$(persona_wip "$c_persona")\n'
    NAIVE = ('      PWIPF="$LOCAL/run/naive-$c_persona"\n'
             '      [ -f "$PWIPF" ] || persona_wip "$c_persona" > "$PWIPF"\n'
             '      PWIP=$(cat "$PWIPF")\n'
             '      sleep 3\n')
    assert src.count(CALL) == 1, "대조군을 만들 자리가 없다 - persona_wip 호출부가 갈렸다"
    mkfile(os.path.join(naive_dir, "tick.sh"), src.replace(CALL, NAIVE), 0o755)
    NWS = {}
    for n in ("w1", "w2", "w3", "w4", "w5"):
        NWS[n] = mkfile(os.path.join(root, "workers", "n" + n + ".sh"),
                        WORKER.format(name="n" + n, tmp=tmp,
                                      tick=os.path.join(naive_dir, "tick.sh")), 0o755)

    def race(ws, local_of):
        limit("pm", "1\n")
        queue(open_=[("cccc000%d" % i, "pm") for i in range(1, 6)])
        ps = [subprocess.Popen([ws[n], "tick"], stdout=subprocess.DEVNULL,
                               stderr=subprocess.DEVNULL,
                               env=dict(env, TICKET_LOCAL=local_of(n)))
              for n in ("w1", "w2", "w3", "w4", "w5")]
        for p in ps:
            p.wait(timeout=180)
        return wips()

    ctl = race(NWS, lambda n: os.path.join(tmp, "local-" + n))
    assert len(ctl) >= 2, \
        "대조군이 {}장이다 - 다섯 워커가 같은 창에 안 들어갔으면 ④는 공허하다".format(len(ctl))
    got = race(WS, lambda n: local)
    assert len(got) == 1, "상한 1인데 {}장을 잡았다: {}".format(len(got), got)
    RACE = (len(got), len(ctl))

    # --- ⑤ 손 claim이 센다: 사람이 1장 쥐고 있으면 상한 1의 cron은 뜨지 않는다 ---
    limit("pm", "1\n")
    queue(open_=[("dddd0001", "pm"), ("dddd0002", "pm")])
    hc = subprocess.run([sys.executable, PY, "handclaim", os.path.join(tdir, "dddd0001.md")],
                        capture_output=True, text=True)
    assert hc.returncode == 0, hc.stderr
    before = len(log())
    tick()
    added = log()[before:]
    assert added.count("SKIP 페르소나 상한 pm 1/1") == 1, "손 claim을 안 셌다:\n" + added
    assert "DISPATCH" not in added, "손 claim이 있는데 디스패치했다:\n" + added
    assert wips() == ["dddd0001.wip.md"], wips()

    # --- ⑥ 잠금: 지킬 상한이 없으면 안 잡고, 산 주인은 못 밀고, 스테일은 WARN과 함께 회수 ---
    # 상한 파일이 하나도 없으면 임계구역 자체가 없다(`상한 없음`이 기본값이라 종전 그대로다).
    # 산 주인이 물고 있는 잠금을 놔둔 채로도 그대로 뜬다 - 잠금을 보지도 않는다는 뜻이다.
    limit("pm", None)
    queue(open_=[("ffff0001", "pm")])
    mkfile(os.path.join(slock, "pid"), str(os.getpid()))
    before = len(log())
    tick()
    added = log()[before:]
    assert "DISPATCH ffff0001" in added, "상한이 0개인데 잠금이 막았다:\n" + added
    assert "SKIP 다른 워커가 선정 중이다" not in added, added

    # 상한 파일이 하나라도 있으면 그때부터 잠금이 그대로다. 진 워커는 SKIP하고 **주인의 잠금을
    # 지우지 않는다**(지우면 다음 워커가 임계구역 한복판으로 걸어 들어간다).
    limit("pm", "9\n")                                      # 안 걸리는 값 - 재는 것은 잠금이다
    queue(open_=[("eeee0001", "pm")])
    before = len(log())
    tick()
    added = log()[before:]
    assert "SKIP 다른 워커가 선정 중이다 pid={}".format(os.getpid()) in added, \
        "산 잠금을 밀고 들어갔다:\n" + added
    assert "DISPATCH" not in added, "잠금을 못 얻었는데 디스패치했다:\n" + added
    assert os.path.exists(slock), "진 워커가 주인의 잠금을 지웠다"
    assert wips() == [], wips()

    dead = subprocess.Popen([sys.executable, "-c", ""])
    dead.wait()
    mkfile(os.path.join(slock, "pid"), str(dead.pid))
    before = len(log())
    tick()
    added = log()[before:]
    assert "WARN 스테일 선정 잠금 회수 pid={}".format(dead.pid) in added, \
        "스테일 잠금을 안 회수했다:\n" + added
    assert "DISPATCH eeee0001" in added, "회수하고도 디스패치를 안 했다:\n" + added
    assert not os.path.exists(slock), "임계구역을 나가면서 잠금을 안 놓았다(세션 내내 쥔다)"

    # --- ⑦ 큐 무수정 + 새 로그 낱말 0 ---
    audit()
    words = set()
    for line in log().split("\n"):
        m = LOGLINE.match(line)
        if m:
            words.add(m.group(1))
    assert words <= ALLOWED_LOG, "새 로그 낱말이 생겼다: {}".format(sorted(words - ALLOWED_LOG))

    print("OK - 페르소나 상한 (미달 · 도달+양끝공백 3모양 · 0/없음/빈파일/abc · "
          "동시 claim {}장 vs 대조군 {}장 · 손 claim · 잠금 스테일 회수 · "
          "티켓 {}건 무수정 · 로그 낱말 {}종)".format(RACE[0], RACE[1], audited[0], len(words)))
finally:
    subprocess.run(["pkill", "-f", os.path.join(tmp, "fake-engine.sh")], capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)
