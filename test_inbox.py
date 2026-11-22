#!/usr/bin/env python3
"""참견 입구(FIFO) 자체검증: 스트리밍 입력 엔진일 때만 입구가 뜨는가.

진짜 claude를 부르지 않는다 -- stdin JSONL을 받아 적고 `result` 줄을 뱉은 뒤 스스로는
안 끝나는 가짜 스트림 엔진으로 판정한다(그게 실측된 진짜 엔진의 행동이다).
실패하면 assert로 죽는다.
"""
__import__("os").environ.setdefault("DIRA_MIGRATIONS_DIR", __import__("tempfile").mkdtemp())  # 마이그레이션 게이트(P505)가 임시 루트를 막지 않게 빈 항목 폴더로
import os
import re
import sys
import json
import stat
import time
import shutil
import tempfile
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")
PY = os.path.join(HERE, "tickets.py")

WORKER = """\
#!/bin/bash
TICKET_NAME="strm"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/fake-stream.sh" "{{sid}}" "--input-format" "stream-json")
. "{tick}"
"""

# 가짜 스트림 엔진: 최초 프롬프트를 받아 적고 -> result가 아닌 줄을 마지막에 세운 채 참견을
# 기다리고 -> 자기 손으로 .wip을 .done으로 닫고 -> 진짜 result를 뱉고 -> 스스로는 안 끝난다
# (sleep 60). 진짜 엔진의 행동이 이렇다.
#   기다리는 4초 = 스트림이 멎었다고 죽이면 참견을 못 받고 잘린다(아래 2줄 단언이 깨진다).
#   닫는 자리 = 엔진 수정 서른네 번째 승인 §판정 2(4ba59104) - 세션이 끝까지 갔는데 .wip을
#   안 닫으면 이제 무조건 FAIL이다. 진짜 세션도 마지막 턴에서 스스로 이 mv를 한다.
#   result 줄 = 실측된 키 순서(`is_error`가 먼저). 접두사 매치로는 안 잡힌다.
ENGINE = """\
#!/bin/bash
IFS= read -r first
printf '%s\\n' "$first" >> "{tmp}/engine-stdin.jsonl"
printf '{{"type":"system","subtype":"init"}}\\n'
cat "{tmp}/decoy.jsonl"
sleep 4
IFS= read -r -t 20 more && printf '%s\\n' "$more" >> "{tmp}/engine-stdin.jsonl"
wip=$(ls "{tmp}/dira/tickets"/*.wip.md 2>/dev/null | head -1)
[ -n "$wip" ] && mv "$wip" "${{wip%.wip.md}}.done.md"
printf '{{"is_error":false,"num_turns":3,"session_id":"%s","type":"result","subtype":"success"}}\\n' "$1"
sleep 60
"""


def mk(root, name, fm=""):
    d = os.path.join(root, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, name + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\ntitle: t\n{}---\n\n## Goal\ntest\n".format(name, fm))
    return p


def fm_get(path, key):
    with open(path, encoding="utf-8") as f:
        for line in f.read().split("\n")[1:]:
            if line.strip() == "---":
                break
            m = re.match(r"^" + key + r":\s*(.*)$", line)
            if m:
                return m.group(1).strip()
    return ""


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    os.makedirs(os.path.join(root, "workers"), exist_ok=True)
    w = os.path.join(root, "workers", "strm.sh")
    with open(w, "w", encoding="utf-8") as f:
        f.write(WORKER.format(tmp=tmp, tick=TICK))
    os.chmod(w, 0o755)
    with open(os.path.join(tmp, "decoy.jsonl"), "w", encoding="utf-8") as f:
        f.write(json.dumps({"type": "assistant", "message": {"role": "assistant",
                            "content": "일하는 중"}},
                           ensure_ascii=False, separators=(",", ":")) + "\n")
    eng = os.path.join(tmp, "fake-stream.sh")
    with open(eng, "w", encoding="utf-8") as f:
        f.write(ENGINE.format(tmp=tmp))
    os.chmod(eng, 0o755)

    wip = mk(root, "feed0001")[:-3] + ".wip.md"
    inbox_dir = os.path.join(tmp, "inbox-dir")
    env = dict(os.environ, TICKET_LOCAL=local, DIRA_INBOX_DIR=inbox_dir)

    # 정리 판정용 씨앗(P569-1): 옛 자리(local/run)와 새 자리에 25시간 전 FIFO+.human, 1시간 전 FIFO,
    # 25시간 전 일반 파일 inbox-zzz. 25시간 전 FIFO와 그 .human만 사라져야 한다.
    old_run = os.path.join(local, "run")
    os.makedirs(old_run)
    os.makedirs(inbox_dir)
    seeds = {}
    for d in (old_run, inbox_dir):
        for name, kind, age in (("inbox-old", "p", 25), ("inbox-new", "p", 1), ("inbox-zzz", "f", 25)):
            path = os.path.join(d, name)
            if kind == "p":
                os.mkfifo(path)
            else:
                open(path, "w").close()
            t = time.time() - age * 3600
            os.utime(path, (t, t))
        open(os.path.join(d, "inbox-old.human"), "w").close()
        seeds[d] = 1
    started = time.time()
    proc = subprocess.Popen([w, "tick"], stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, env=env)

    # 1) 도는 동안 fm에 inbox: 가 있고 그 경로가 진짜 FIFO다
    inbox = ""
    for _ in range(120):
        if os.path.exists(wip):
            inbox = fm_get(wip, "inbox")
            if inbox:
                break
        time.sleep(0.25)
    assert inbox, "도는 동안 fm에 inbox:가 안 써졌다"
    assert stat.S_ISFIFO(os.stat(inbox).st_mode), "inbox 경로가 FIFO가 아니다: " + inbox

    assert os.path.dirname(inbox) == inbox_dir, "inbox가 DIRA_INBOX_DIR 밖이다: " + inbox
    out = subprocess.run(["find", local, "-type", "p", "!", "-name", "inbox-new"], capture_output=True, text=True).stdout
    assert out.strip() == "", "TICKET_LOCAL 아래 FIFO가 남았다: " + out
    for d in (old_run, inbox_dir):
        assert not os.path.exists(os.path.join(d, "inbox-old")), "25시간 전 FIFO가 안 치워졌다: " + d
        assert not os.path.exists(os.path.join(d, "inbox-old.human")), ".human이 안 치워졌다: " + d
        assert os.path.exists(os.path.join(d, "inbox-zzz")), "일반 파일이 지워졌다: " + d
    assert stat.S_ISFIFO(os.stat(os.path.join(old_run, "inbox-new")).st_mode), "1시간 전 FIFO(옛 자리)가 사라졌다"
    assert stat.S_ISFIFO(os.stat(os.path.join(inbox_dir, "inbox-new")).st_mode), "1시간 전 FIFO(새 자리)가 사라졌다"

    # 2) 그 입구로 참견 한 줄을 밀어 넣으면 엔진의 stdin에 도착한다
    with open(inbox, "w", encoding="utf-8") as f:
        f.write('{"type":"user","message":{"role":"user",'
                '"content":"참견-마커"}}\n')

    proc.wait(timeout=90)
    elapsed = time.time() - started
    # 엔진은 result 뒤 60초를 잔다. tick.sh가 result 줄을 보고 죽이지 않으면 여기서 걸린다.
    assert elapsed < 45, "result 줄을 보고 안 끝냈다({:.1f}s)".format(elapsed)

    with open(os.path.join(tmp, "engine-stdin.jsonl"), encoding="utf-8") as f:
        lines = [l for l in f.read().split("\n") if l.strip()]
    assert len(lines) == 2, "엔진 stdin에 2줄이 안 왔다: {}".format(lines)
    assert '"type":"user"' in lines[0] and "please pick up feed0001" in lines[0], \
        "최초 프롬프트가 FIFO에 JSON 한 줄로 안 갔다: " + lines[0]
    assert "참견-마커" in lines[1], "참견이 도는 세션에 안 닿았다: " + lines[1]

    # 3) 세션이 끝나면 FIFO는 남지 않는다
    assert not os.path.exists(inbox), "세션 뒤에 FIFO가 남았다: " + inbox

    # 4) result가 성공이면 RC(우리가 죽여서 143)와 무관하게 성공 처리다 -- 세션이 스스로 닫은
    #    티켓이라 할당(session_id)이 회수되지 않고 그대로 .done에 남는다(§판정 2, 4ba59104).
    with open(os.path.join(root, "workers", "runner.log"), encoding="utf-8") as f:
        rlog = f.read()
    assert "DISPATCH feed0001" in rlog and "DONE feed0001" in rlog, \
        "result 줄로 성공 판정을 못 했다\n" + rlog
    done = wip[:-len(".wip.md")] + ".done.md"
    assert os.path.exists(done), "세션이 스스로 닫은 티켓이 .done으로 안 남았다"
    assert fm_get(done, "session_id"), "성공했는데 할당이 회수됐다"

    # 5) clear는 session_id·pid와 함께 inbox도 비운다
    subprocess.run([sys.executable, PY, "clear", done], check=True, timeout=30)
    assert fm_get(done, "inbox") == "", "clear가 inbox를 안 비웠다"
    assert fm_get(done, "session_id") == "", "clear가 session_id를 안 비웠다"

    # 6) DIRA_INBOX_DIR이 없으면 ${TMPDIR}/dira-inbox-<uid>, 권한 drwx------ (P569-1)
    tmpd = os.path.join(tmp, "tmpd")
    os.makedirs(tmpd)
    env2 = {k: v for k, v in os.environ.items() if k != "DIRA_INBOX_DIR"}
    env2.update(TICKET_LOCAL=local, TMPDIR=tmpd)
    wip2 = mk(root, "feed0002")[:-3] + ".wip.md"
    p2 = subprocess.Popen([w, "tick"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env2)
    ib2 = ""
    for _ in range(120):
        if os.path.exists(wip2):
            ib2 = fm_get(wip2, "inbox")
            if ib2:
                break
        time.sleep(0.25)
    assert ib2, "기본 자리 디스패치에서 inbox:가 안 써졌다"
    want = os.path.join(tmpd, "dira-inbox-%d" % os.getuid())
    assert os.path.dirname(ib2) == want, "기본 자리가 틀렸다: " + ib2
    assert stat.S_IMODE(os.stat(want).st_mode) == 0o700, "권한이 700이 아니다"
    p2.wait(timeout=90)

    print("PASS 참견 입구(FIFO)·최초 프롬프트 JSONL·result 종료·clear")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
