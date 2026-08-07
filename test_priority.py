#!/usr/bin/env python3
"""§1-3 우선순위 자체검증(docs/DESIGN.md §1-3): frontmatter `priority:`가 dot과 디스패치
순서를 같이 정하는가.

판정은 임시 큐에서만 낸다(§제약 1 — 도그푸딩 큐를 안 쓴다). §1-3 §검증의 ①~⑥·⑪을 잰다 -
⑦~⑩(선점)은 다음 티켓(`40ce8b2a`)의 몫이라 여기서 안 잰다.

①~③·⑤·⑥은 `tickets.py`(scan·select) 순수 로직이라 서브프로세스로 잰다. ④(1 게이트)는
`tick.sh` 선정 루프의 일이라 워커 + `dryrun`으로 잰다 - dryrun은 읽기만 해서 claim이 없고
그래서 ⑪(큐 무수정) 감사와 같은 판에 넣을 수 있다.

실패하면 assert로 죽는다.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
PY = os.path.join(HERE, "tickets.py")
TICK = os.path.join(HERE, "tick.sh")

sys.path.insert(0, HERE)
import tickets as T  # noqa: E402 (경로 삽입 뒤에 임포트)

# ⑪ 큐 무수정: 이 티켓이 새로 쓰는 frontmatter 키는 `priority` 하나뿐이고, 그것도 안 쓴다
# (계산값이라 파일에 안 남는다). 아래 픽스처가 손으로 심는 키 + 이 티켓 이전부터 있던
# 디스패처 키만 허용한다.
ALLOWED_FM = {"ticket", "title", "priority", "deps",
              "session_id", "assigned_at", "owner", "pid", "inbox"}


def mk(root, h, fm=""):
    d = os.path.join(root, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\ntitle: t\n{}---\n\n## Goal\ntest\n".format(h, fm))
    return p


def audit(root):
    """지금 큐에 있는 티켓 전부의 frontmatter 키가 ALLOWED_FM 안인지 본다(⑪)."""
    tdir = os.path.join(root, "tickets")
    if not os.path.isdir(tdir):
        return
    for f in sorted(os.listdir(tdir)):
        with open(os.path.join(tdir, f), encoding="utf-8") as fh:
            lines = fh.read().split("\n")
        assert lines[0] == "---", "frontmatter가 깨졌다: " + f
        for line in lines[1:]:
            if line.strip() == "---":
                break
            m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*):", line)
            assert not m or m.group(1) in ALLOWED_FM, \
                "새 frontmatter 키가 생겼다: {} ({})".format(m.group(1), f)


def reset(root):
    audit(root)
    tdir = os.path.join(root, "tickets")
    if os.path.isdir(tdir):
        shutil.rmtree(tdir)


def select_rows(root):
    """`tickets.py select`를 서브프로세스로 불러 (순서, {해시: (priority, effective)}, stderr)."""
    r = subprocess.run([sys.executable, PY, "select", root],
                       capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    order, vals = [], {}
    for line in r.stdout.strip().split("\n"):
        if not line:
            continue
        _path, h, _kind, _persona, prio, eff = line.split("|")
        order.append(h)
        vals[h] = (int(prio), int(eff))
    return order, vals, r.stderr


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")

    # --- ① 정렬 — priority가 FIFO를 이긴다 ---
    # aaaa(1)를 가장 먼저, cccc(5)를 가장 늦게 만든다. 알파벳 순(경로 tie-break)만 봐도 aaaa가
    # 먼저 서야 하는 판인데, 유효 우선순위가 그 순서를 뒤집어 cccc가 첫 줄에 서야 한다.
    mk(root, "aaaa0001", "priority: 1\n")
    mk(root, "bbbb0002", "priority: 3\n")
    mk(root, "cccc0003", "priority: 5\n")
    order, vals, err = select_rows(root)
    assert order[0] == "cccc0003", "5가 첫 줄이 아니다(FIFO를 못 이겼다): " + str(order)
    assert vals["cccc0003"] == (5, 5), vals
    assert vals["bbbb0002"] == (3, 3), vals
    assert vals["aaaa0001"] == (1, 1), vals
    reset(root)

    # --- ② 같은 값 안에서는 FIFO다 ---
    # 이름을 생성 순으로 맞춘다(aaaa < bbbb < cccc) - birth가 같은 초에 묶여도 정렬 키의
    # tie-break(경로)가 이 순서를 그대로 지킨다(test_persona_engine.py와 같은 관용구).
    mk(root, "aaaa0001", "priority: 3\n")
    mk(root, "bbbb0002", "priority: 3\n")
    mk(root, "cccc0003", "priority: 3\n")
    order, vals, err = select_rows(root)
    assert order == ["aaaa0001", "bbbb0002", "cccc0003"], \
        "같은 우선순위 안 FIFO가 깨졌다: " + str(order)
    reset(root)

    # --- ③ 없거나 망가진 값은 3이다. 못 읽는 둘만 WARN ---
    mk(root, "aaaa0001", "")                     # 키 없음 - 무경고
    mk(root, "bbbb0002", "priority: 9\n")        # 1~5 밖 - WARN
    mk(root, "cccc0003", "priority: abc\n")      # 정수 아님 - WARN
    order, vals, err = select_rows(root)
    assert vals["aaaa0001"] == (3, 3), vals
    assert vals["bbbb0002"] == (3, 3), vals
    assert vals["cccc0003"] == (3, 3), vals
    assert err.count("WARN") == 2, "WARN이 2줄이 아니다:\n" + err
    assert "aaaa0001" not in err, "키 없음인데 경고했다:\n" + err
    reset(root)

    # --- ⑤ 상속 — 미충족 dep은 자기를 기다리는 티켓의 값을 물려받는다(역방향·체인·순환) ---
    # A(5) deps [B(3)] deps [C(3)] deps [D(3)] - D가 체인 끝까지 5로 뜬다.
    # select는 deps 미충족 티켓을 후보로 안 보여주므로(A·B·C 전부 미충족) scan()으로 직접 본다.
    mk(root, "aaaa0001", "priority: 5\ndeps: [bbbb0002]\n")
    mk(root, "bbbb0002", "priority: 3\ndeps: [cccc0003]\n")
    mk(root, "cccc0003", "priority: 3\ndeps: [dddd0004]\n")
    mk(root, "dddd0004", "priority: 3\n")
    eff = {r["hash"]: r["effective"] for r in T.scan(root)}
    assert eff == {"aaaa0001": 5, "bbbb0002": 5, "cccc0003": 5, "dddd0004": 5}, eff

    # 순환 — X<->Y, 둘 다 3. 안 멈추고(타임아웃 없이 반환) 유한 값으로 끝난다.
    mk(root, "xxxx0005", "priority: 3\ndeps: [yyyy0006]\n")
    mk(root, "yyyy0006", "priority: 3\ndeps: [xxxx0005]\n")
    eff = {r["hash"]: r["effective"] for r in T.scan(root)}
    assert eff["xxxx0005"] == 3 and eff["yyyy0006"] == 3, eff

    # --- ⑥ 상속은 파일을 안 고친다 ---
    with open(os.path.join(root, "tickets", "dddd0004.md"), encoding="utf-8") as f:
        assert "priority: 3" in f.read(), "상속 계산이 B의 frontmatter를 고쳤다"
    reset(root)

    # --- ④ 1 게이트 — 유효 1은 .wip이 0건일 때만 후보다(tick.sh 선정 루프) ---
    # dryrun은 claim이 없는 미리보기라 이 판정을 오염 없이 잰다.
    workers = os.path.join(root, "workers")
    os.makedirs(workers, exist_ok=True)
    w1 = os.path.join(workers, "w1.sh")
    with open(w1, "w", encoding="utf-8") as f:
        f.write('#!/bin/bash\n'
                'TICKET_NAME="w1"\n'
                'TICKET_CWD="{tmp}"\n'
                'TICKET_ENGINE=("/bin/true" "{{prompt}}" "{{sid}}")\n'
                '. "{tick}"\n'.format(tmp=tmp, tick=TICK))
    os.chmod(w1, 0o755)
    local = os.path.join(tmp, "local")

    def dryrun():
        r = subprocess.run([w1, "dryrun"], capture_output=True, text=True,
                           env=dict(os.environ, TICKET_LOCAL=local), timeout=30)
        assert r.returncode == 0, r.stdout + r.stderr
        return r.stdout

    def runlog():
        try:
            with open(os.path.join(workers, "runner.log"), encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    # .wip 1장 있으면 유효 1은 후보가 아니다 - 유일한 후보라 이번 tick은 아무것도 안 고른다
    mk(root, "aaaa0001", "priority: 1\n")
    shutil.move(os.path.join(root, "tickets", "aaaa0001.md"),
               os.path.join(root, "tickets", "wwww0002.wip.md"))
    with open(os.path.join(root, "tickets", "wwww0002.wip.md"), "w", encoding="utf-8") as f:
        f.write("---\nticket: wwww0002\ntitle: t\n---\n\n## Goal\ntest\n")
    mk(root, "bbbb0003", "priority: 1\n")
    before = len(runlog())
    out = dryrun()
    added = runlog()[before:]
    assert "선정:" not in out, "진행중 1건인데 유효 1이 떴다:\n" + out
    assert "SKIP 우선순위 1 bbbb0003 — 진행중 1건" in added, \
        "1 게이트 SKIP 로그가 없다:\n" + added

    # .wip 0장이면 유효 1이 후보다
    os.remove(os.path.join(root, "tickets", "wwww0002.wip.md"))
    out = dryrun()
    assert "선정: bbbb0003" in out, "진행중 0건인데 유효 1이 안 떴다:\n" + out
    reset(root)
    shutil.rmtree(workers, ignore_errors=True)

    print("OK - test_priority §1-3 §검증 ①~⑥·⑪")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
