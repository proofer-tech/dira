#!/usr/bin/env python3
"""세션 재활용(§4-11) 자체검증. docs/DESIGN.md §4-11 §검증 ①~⑧을 전부 덮는다.

진짜 claude를 부르지 않는다(§제약 1) - stdin JSONL을 세그먼트 단위로 받아 적고, 세그먼트마다
`result` 줄을 뱉기 전에 (지정됐으면) 티켓을 스스로 `.done`으로 닫는 가짜 스트림 엔진
(`fake_engine.py`, plan.json으로 세그먼트를 기술)으로 판정한다. 임시 큐 + 임시 워커다.

① 같은 페르소나 티켓 2장 -> 한 세션이 둘 다 처리, DISPATCH 2줄이 같은 sid, 둘째 주입은
   짧은 프롬프트(코어 마커가 없다)
② 다음 티켓이 없으면 result 후 세션이 죽고 워커가 끝난다(반환)
③ 첫 티켓이 `.wip`인 채 result가 오면 재활용하지 않는다
④ 마지막 턴 컨텍스트가 예산 이상이면 재활용하지 않는다
⑤ 둘째 구간이 err면 둘째 티켓만 회수된다(첫 티켓은 .done 그대로)
⑥ 오프셋 - 둘째 주입 직후 첫 티켓의 result 줄을 보고 죽이지 않는다(①과 같은 실행에서 같이 잰다 -
   둘째 세그먼트를 폴링 주기보다 느리게 만들어 offset 없이 죽으면 반드시 걸리게 한다)
⑦ 페르소나 상한 1에서도 이어 받는다(자기 티켓이 닫힌 뒤라 0 < 1)
⑧ TICKET_REUSE=0 · 비스트리밍 엔진 - 전부 종전 경로 그대로(회귀)

실패하면 assert로 죽는다.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TICK = os.path.join(HERE, "tick.sh")

WORKER = """\
#!/bin/bash
TICKET_NAME="w1"
TICKET_CWD="{root_parent}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{engine}" "{{sid}}" "{plan}" "{stdinlog}" "--input-format" "stream-json")
{extra_env}
. "{tick}"
"""

NOREUSE_WORKER = """\
#!/bin/bash
TICKET_NAME="w1"
TICKET_CWD="{root_parent}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{engine}" "{{sid}}")
{extra_env}
. "{tick}"
"""

# 스트리밍 가짜 엔진: 최초 프롬프트를 받아 적고 -> plan.json의 세그먼트를 순서대로 처리한다.
# 세그먼트마다: (첫 세그먼트가 아니면) 다음 줄을 기다려 받아 적고 -> close가 있으면 그 파일을
# rename(세션이 손으로 티켓을 닫는 것의 대체) -> sleep_before_result -> ctx가 있으면 assistant
# usage 줄 -> result 줄. 전부 끝나면 진짜 엔진처럼 스스로는 안 끝난다(sleep 60).
FAKE_ENGINE = """\
#!/usr/bin/env python3
import json, os, sys, time

sid = sys.argv[1]
with open(sys.argv[2], encoding="utf-8") as f:
    plan = json.load(f)
stdinlog = sys.argv[3]

def logline(line):
    with open(stdinlog, "a", encoding="utf-8") as lf:
        lf.write(line if line.endswith("\\n") else line + "\\n")

first = sys.stdin.readline()
if first:
    logline(first)

def emit(obj):
    # 압축 JSON(공백 없음) - 실제 claude 출력과 같은 모양이다. tick.sh의 is_result는
    # `"type":"result"`를 콜론 뒤 공백 없이 grep한다 - json.dumps 기본값(공백 있음)을 쓰면
    # 그 grep이 영영 안 걸려 재활용 판정이 한 번도 안 뜬다.
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\\n")
    sys.stdout.flush()

emit({"type": "system", "subtype": "init"})

for i, seg in enumerate(plan):
    if i > 0:
        line = sys.stdin.readline()
        if line:
            logline(line)
    # 첫 세그먼트에서 초기 디스패치 자신의 setinbox(§init 감지 뒤)와 경합한다 - 진짜 세션은
    # 실제 작업을 하고 나서 닫으므로 이 정도 지연도 없다. 0.3s로 그 경합을 없앤다.
    time.sleep(0.3)
    close = seg.get("close")
    if close:
        try:
            os.rename(close[0], close[1])
        except OSError:
            pass
    time.sleep(seg.get("sleep_before_result", 0))
    ctx = seg.get("ctx")
    if ctx is not None:
        usage = {"input_tokens": ctx, "cache_creation_input_tokens": 0,
                 "cache_read_input_tokens": 0}
        emit({"type": "assistant", "message": {"role": "assistant", "content": "working",
                                                "usage": usage}})
    ok = seg.get("ok", True)
    emit({"type": "result", "subtype": "success" if ok else "error", "is_error": not ok,
          "session_id": sid, "num_turns": i + 1})

time.sleep(60)
"""

# 비스트리밍 가짜 엔진(⑧b 회귀) - test_persona_engine.py와 같은 모양. sid를 받아 즉시 성공
# result를 낸다(codex류와 같은 갈래 - FIFO 없이 rc로 판정된다).
NOREUSE_ENGINE = """\
#!/bin/bash
printf '{"session_id":"%s","type":"result","is_error":false,"subtype":"success"}\\n' "$1"
exit 0
"""


def mkfile(path, body, mode=0o644):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(path, mode)
    return path


def mk_ticket(tickets_dir, h, persona):
    mkfile(os.path.join(tickets_dir, h + ".md"),
           "---\nticket: {h}\ntitle: t\nkind: work\npersona: {p}\n---\n\n## Goal\ntest\n"
           .format(h=h, p=persona))


def wip_of(tickets_dir, h):
    return os.path.join(tickets_dir, h + ".wip.md")


def done_of(tickets_dir, h):
    return os.path.join(tickets_dir, h + ".done.md")


def open_of(tickets_dir, h):
    return os.path.join(tickets_dir, h + ".md")


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    fake_engine = mkfile(os.path.join(tmp, "fake_engine.py"), FAKE_ENGINE, 0o755)

    def build_root(name, persona_limit=None):
        """이 시나리오만의 root/local/tickets를 새로 세운다 - 다른 시나리오와 상태를 안 섞는다."""
        root = os.path.join(tmp, name, "dira")
        local = os.path.join(tmp, name, "local")
        tickets = os.path.join(root, "tickets")
        os.makedirs(local, exist_ok=True)
        os.makedirs(tickets, exist_ok=True)
        if persona_limit is not None:
            mkfile(os.path.join(root, "personas", "solo", "limit"), persona_limit + "\n")
        return root, local, tickets

    def run_stream(name, segs_by_hash, extra_env="", persona_limit=None, timeout=60):
        """스트리밍 시나리오 실행. segs_by_hash = [(hash, [seg, ...]), ...] - 첫 해시의 세그먼트가
        도는 세션이 받는 순서 전체다(재활용이 일어나면 둘째 해시의 세그먼트로 이어진다).
        여기서는 세그먼트를 한 세션의 흐름 그대로 이어붙여 plan.json 하나로 낸다."""
        root, local, tickets = build_root(name, persona_limit)
        for h, persona in segs_by_hash["tickets"]:
            mk_ticket(tickets, h, persona)
        plan_path = os.path.join(tmp, name, "plan.json")
        stdinlog = os.path.join(tmp, name, "stdin.jsonl")
        mkfile(plan_path, json.dumps(segs_by_hash["segments"]))
        w = mkfile(os.path.join(root, "workers", "w1.sh"),
                   WORKER.format(root_parent=os.path.dirname(root), engine=fake_engine,
                                 plan=plan_path, stdinlog=stdinlog, tick=TICK,
                                 extra_env=extra_env), 0o755)
        env = dict(os.environ, TICKET_LOCAL=local)
        # rc는 여기서 안 잰다 - 세그먼트가 err로 끝나는 시나리오(⑤)는 tick.sh가 실패로
        # 143/1을 그대로 내는 것이 옳다(§4-9). 성공을 기대하는 시나리오는 각자 runlog로 확인한다.
        r = subprocess.run([w, "tick"], capture_output=True, text=True, env=env, timeout=timeout)
        runlog = ""
        try:
            with open(os.path.join(root, "workers", "runner.log"), encoding="utf-8") as f:
                runlog = f.read()
        except OSError:
            pass
        lines = []
        if os.path.exists(stdinlog):
            with open(stdinlog, encoding="utf-8") as f:
                lines = [l for l in f.read().split("\n") if l.strip()]
        return root, tickets, runlog, lines

    # --- ①+⑥ 같은 페르소나 티켓 2장 -> 같은 세션이 이어 받는다. 둘째 세그먼트는 result 전에
    # 3초를 잔다 - offset 없이 죽이면(구현 함정 1호) 이 sleep이 끝나기 훨씨 전에(폴링 주기 1초)
    # 둘째 티켓이 .wip인 채로 프로세스가 죽어 아래 done 단언이 깨진다.
    h1, h2 = "aaa10001", "aaa10002"
    tickets_a = os.path.join(tmp, "scn_a", "dira", "tickets")
    root, tickets, runlog, lines = run_stream("scn_a", {
        "tickets": [(h1, "solo"), (h2, "solo")],
        "segments": [
            {"ctx": 1000, "ok": True, "close": [wip_of(tickets_a, h1), done_of(tickets_a, h1)]},
            {"ctx": 1000, "ok": True, "sleep_before_result": 3,
             "close": [wip_of(tickets_a, h2), done_of(tickets_a, h2)]},
        ],
    })
    assert runlog.count("DISPATCH " + h1) == 1, "①: t1 DISPATCH가 1번이 아니다\n" + runlog
    assert runlog.count("DISPATCH " + h2) == 1, "①: t2 DISPATCH가 안 났다(재활용 실패)\n" + runlog
    assert runlog.count("DONE " + h1) == 1 and runlog.count("DONE " + h2) == 1, \
        "①: DONE 짝이 안 맞다\n" + runlog
    m1 = re.search(r"DISPATCH " + h1 + r".*sid=(\S+)", runlog)
    m2 = re.search(r"DISPATCH " + h2 + r".*sid=(\S+)", runlog)
    assert m1 and m2 and m1.group(1) == m2.group(1), "①: 같은 sid가 아니다\n" + runlog
    assert os.path.exists(done_of(tickets, h1)), "①+⑥: t1이 .done이 아니다"
    assert os.path.exists(done_of(tickets, h2)), "①+⑥: t2가 .done이 아니다(offset 함정 재발)"
    assert len(lines) == 2, "①: 세션이 받은 줄이 2개가 아니다: {}".format(lines)
    assert "pick up " + h1 in lines[0], "①: 최초 프롬프트에 t1 해시가 없다: " + lines[0]
    assert "pick up " + h2 in lines[1], "①: 둘째 주입에 t2 해시가 없다: " + lines[1]
    assert "CORE.md" not in lines[1] and len(lines[1]) < 300, \
        "①: 둘째 주입이 짧은 프롬프트가 아니다(코어 재주입): " + lines[1][:200]
    print("PASS ① 같은 세션 이어받기 + ⑥ 오프셋(둘째 티켓이 느려도 안 죽인다)")

    # --- ② 다음 티켓이 없으면 종전과 같은 모양으로 끝난다(반환) ---
    h3 = "bbb10001"
    began = time.time()
    root, tickets, runlog, lines = run_stream("scn_b", {
        "tickets": [(h3, "solo")],
        "segments": [{"ctx": 1000, "ok": True, "close": [
            wip_of(os.path.join(tmp, "scn_b", "dira", "tickets"), h3),
            done_of(os.path.join(tmp, "scn_b", "dira", "tickets"), h3)]}],
    })
    took = time.time() - began
    assert took < 40, "②: 다음 티켓이 없는데도 오래 걸렸다({:.0f}s) - 죽이지 않고 기다렸나".format(took)
    assert runlog.count("DISPATCH " + h3) == 1, "②: DISPATCH가 1번이 아니다\n" + runlog
    assert runlog.count("DISPATCH") == 1, "②: 재활용할 후보가 없는데 DISPATCH가 더 났다\n" + runlog
    print("PASS ② 다음 티켓 없음 -> 정상 반환")

    # --- ③ 첫 티켓이 .wip인 채 result가 오면 재활용하지 않는다(close 없음) ---
    h4, h5 = "ccc10001", "ccc10002"
    root, tickets, runlog, lines = run_stream("scn_c", {
        "tickets": [(h4, "solo"), (h5, "solo")],
        "segments": [{"ctx": 1000, "ok": True}],   # close 없음 - 스스로 안 닫는다
    })
    assert runlog.count("DISPATCH " + h4) == 1, "③\n" + runlog
    assert runlog.count("DISPATCH " + h5) == 0, "③: .wip인 채인데 재활용됐다\n" + runlog
    assert os.path.exists(wip_of(tickets, h4)), "③: t1이 .wip이 아니게 됐다"
    assert os.path.exists(open_of(tickets, h5)), "③: t2가 claim됐다(열림 파일이 없다)"
    print("PASS ③ .wip인 채 result -> 재활용 안 함")

    # --- ④ 마지막 턴 컨텍스트가 예산 이상이면 재활용하지 않는다 ---
    h6, h7 = "ddd10001", "ddd10002"
    root, tickets, runlog, lines = run_stream("scn_d", {
        "tickets": [(h6, "solo"), (h7, "solo")],
        "segments": [{"ctx": 5000, "ok": True, "close": [
            wip_of(os.path.join(tmp, "scn_d", "dira", "tickets"), h6),
            done_of(os.path.join(tmp, "scn_d", "dira", "tickets"), h6)]}],
    }, extra_env='TICKET_REUSE_CTX=1000')
    assert runlog.count("DISPATCH " + h6) == 1, "④\n" + runlog
    assert runlog.count("DISPATCH " + h7) == 0, "④: 예산을 넘겼는데 재활용됐다\n" + runlog
    assert os.path.exists(done_of(tickets, h6)), "④: t1은 그래도 닫혀 있어야 한다"
    assert os.path.exists(open_of(tickets, h7)), "④: t2가 claim됐다"
    print("PASS ④ 컨텍스트 예산 초과 -> 재활용 안 함")

    # --- ⑤ 둘째 구간이 err면 둘째 티켓만 회수된다(첫 티켓은 .done 그대로) ---
    h8, h9 = "eee10001", "eee10002"
    root, tickets, runlog, lines = run_stream("scn_e", {
        "tickets": [(h8, "solo"), (h9, "solo")],
        "segments": [
            {"ctx": 1000, "ok": True, "close": [
                wip_of(os.path.join(tmp, "scn_e", "dira", "tickets"), h8),
                done_of(os.path.join(tmp, "scn_e", "dira", "tickets"), h8)]},
            {"ctx": 1000, "ok": False},   # err, 안 닫는다
        ],
    })
    assert runlog.count("DISPATCH " + h8) == 1 and runlog.count("DISPATCH " + h9) == 1, \
        "⑤: 재활용 자체가 안 일어났다\n" + runlog
    assert "FAIL " + h9 in runlog, "⑤: 둘째 티켓의 FAIL이 안 났다\n" + runlog
    assert os.path.exists(done_of(tickets, h8)), "⑤: 첫 티켓이 .done 그대로가 아니다"
    assert os.path.exists(open_of(tickets, h9)), "⑤: 둘째 티켓이 백로그로 안 돌아왔다"
    assert not os.path.exists(wip_of(tickets, h9)), "⑤: 둘째 티켓에 진행중 접미사가 남았다"
    print("PASS ⑤ 둘째 구간 err -> 둘째만 회수, 첫째는 .done 그대로")

    # --- ⑦ 페르소나 상한 1에서도 이어 받는다(자기 티켓이 닫힌 뒤라 0 < 1) ---
    h10, h11 = "fff10001", "fff10002"
    root, tickets, runlog, lines = run_stream("scn_f", {
        "tickets": [(h10, "solo"), (h11, "solo")],
        "segments": [
            {"ctx": 1000, "ok": True, "close": [
                wip_of(os.path.join(tmp, "scn_f", "dira", "tickets"), h10),
                done_of(os.path.join(tmp, "scn_f", "dira", "tickets"), h10)]},
            {"ctx": 1000, "ok": True, "close": [
                wip_of(os.path.join(tmp, "scn_f", "dira", "tickets"), h11),
                done_of(os.path.join(tmp, "scn_f", "dira", "tickets"), h11)]},
        ],
    }, persona_limit="1")
    assert runlog.count("DISPATCH " + h10) == 1 and runlog.count("DISPATCH " + h11) == 1, \
        "⑦: 상한 1에서 재활용이 안 됐다\n" + runlog
    m1 = re.search(r"DISPATCH " + h10 + r".*sid=(\S+)", runlog)
    m2 = re.search(r"DISPATCH " + h11 + r".*sid=(\S+)", runlog)
    assert m1 and m2 and m1.group(1) == m2.group(1), "⑦: 같은 sid로 안 이어받았다\n" + runlog
    assert os.path.exists(done_of(tickets, h10)) and os.path.exists(done_of(tickets, h11)), \
        "⑦: 둘 다 .done이 아니다"
    print("PASS ⑦ 페르소나 상한 1에서도 재활용(자기 몫이 비어 0<1)")

    # --- 이어받기 뒤 STALL: 주입 뒤 TICKET_FEED_TIMEOUT 안에 출력이 안 자라면 죽이고
    # 회수한다(§4-11 §규칙, Done when 1번 항목). 둘째 세그먼트가 result 전에 오래 자서
    # TICKET_FEED_TIMEOUT(짧게 override)을 넘긴다 - 첫 티켓은 그대로 .done이어야 한다.
    h16, h17 = "iii10001", "iii10002"
    tickets_i = os.path.join(tmp, "scn_i", "dira", "tickets")
    root, tickets, runlog, lines = run_stream("scn_i", {
        "tickets": [(h16, "solo"), (h17, "solo")],
        "segments": [
            {"ctx": 1000, "ok": True, "close": [wip_of(tickets_i, h16), done_of(tickets_i, h16)]},
            {"ctx": 1000, "ok": True, "sleep_before_result": 8},
        ],
    }, extra_env="TICKET_FEED_TIMEOUT=3")
    assert "STALL " + h17 in runlog, "이어받기 STALL이 안 났다\n" + runlog
    assert os.path.exists(done_of(tickets, h16)), "이어받기 STALL: 첫 티켓이 .done이 아니다"
    assert os.path.exists(open_of(tickets, h17)), "이어받기 STALL: 둘째 티켓이 백로그로 안 돌아왔다"
    assert not os.path.exists(wip_of(tickets, h17)), "이어받기 STALL: 둘째 티켓에 진행중 접미사가 남았다"
    print("PASS 이어받기 STALL - 주입 뒤 무출력이면 죽이고 회수(첫 티켓은 .done 그대로)")

    # --- ⑧a TICKET_REUSE=0 -> 재활용 기능 전체가 꺼진다(회귀: 종전처럼 티켓마다 새 세션) ---
    h12, h13 = "ggg10001", "ggg10002"
    root, tickets, runlog, lines = run_stream("scn_g", {
        "tickets": [(h12, "solo"), (h13, "solo")],
        "segments": [{"ctx": 1000, "ok": True, "close": [
            wip_of(os.path.join(tmp, "scn_g", "dira", "tickets"), h12),
            done_of(os.path.join(tmp, "scn_g", "dira", "tickets"), h12)]}],
    }, extra_env='TICKET_REUSE=0')
    assert runlog.count("DISPATCH " + h12) == 1, "⑧a\n" + runlog
    assert runlog.count("DISPATCH " + h13) == 0, "⑧a: TICKET_REUSE=0인데 재활용됐다\n" + runlog
    assert os.path.exists(open_of(tickets, h13)), "⑧a: t2가 claim됐다"
    print("PASS ⑧a TICKET_REUSE=0 -> 재활용 완전히 꺼짐")

    # --- ⑧b 비스트리밍 엔진 -> 재활용 경로 자체를 안 타고 종전처럼 끝난다(회귀) ---
    root8, local8, tickets8 = build_root("scn_h")
    h14, h15 = "hhh10001", "hhh10002"
    mk_ticket(tickets8, h14, "solo")
    mk_ticket(tickets8, h15, "solo")
    eng = mkfile(os.path.join(tmp, "scn_h", "engine.sh"), NOREUSE_ENGINE, 0o755)
    w8 = mkfile(os.path.join(root8, "workers", "w1.sh"),
                NOREUSE_WORKER.format(root_parent=os.path.dirname(root8), engine=eng,
                                      tick=TICK, extra_env=""), 0o755)
    env8 = dict(os.environ, TICKET_LOCAL=local8)
    r8 = subprocess.run([w8, "tick"], capture_output=True, text=True, env=env8, timeout=30)
    assert r8.returncode == 0, "⑧b rc={}\n{}".format(r8.returncode, r8.stderr)
    with open(os.path.join(root8, "workers", "runner.log"), encoding="utf-8") as f:
        runlog8 = f.read()
    assert runlog8.count("DISPATCH " + h14) == 1 and "DONE " + h14 in runlog8, \
        "⑧b: 비스트리밍 정상 완료가 안 됐다\n" + runlog8
    assert runlog8.count("DISPATCH " + h15) == 0, "⑧b: 비스트리밍인데 재활용이 일어났다\n" + runlog8
    assert os.path.exists(open_of(tickets8, h15)), "⑧b: t2가 claim됐다"
    print("PASS ⑧b 비스트리밍 엔진 -> 재활용 없이 종전 경로(회귀)")

    print("OK - 세션 재활용(§4-11) ①~⑧ 전부")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
