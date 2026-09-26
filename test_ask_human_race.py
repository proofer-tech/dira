#!/usr/bin/env python3
"""ask_human의 읽기-쓰기 사이 race(2026-09-25 12시간 디스패치 정지). 실패하면 assert로 죽는다.

`read_fm`으로 읽은 뒤 사람이 답을 달아 티켓이 다른 파일로 옮겨지면, 옛 경로에 `open(path, "a")`가
frontmatter 없는 조각 파일을 새로 만들었다. 쓰기 직전 재확인(`ASK-FAIL`)이 이를 막는지 고정한다.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tickets as T


def mk(troot, h, body):
    d = os.path.join(troot, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h + T.IN_PROGRESS + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\n---\n\n{}".format(h, body))
    return p


ws = tempfile.mkdtemp()
try:
    # 정상 경로 - race 없이 부르면 종전과 같은 반환값·내용(수용조건 3)
    h_ok = "okok0001"
    p_ok = mk(ws, h_ok, "## Goal\n평상시 경로.\n")
    msg_ok = T.ask_human(p_ok, h_ok, 3, "자동 회수", blocked=False)
    assert msg_ok.startswith("ASK {}".format(h_ok)), "정상 경로 반환값이 바뀌었다\n" + msg_ok
    ok_body = open(p_ok, encoding="utf-8").read()
    assert "## 질문 1" in ok_body, "정상 경로에 질문 절이 안 붙었다\n" + ok_body
    fm_ok = T.read_fm(p_ok)[0]
    assert fm_ok.get("awaiting"), "정상 경로에 awaiting이 안 걸렸다\n" + str(fm_ok)

    # race 경로 - ask_context 호출 시점(읽기 뒤, 쓰기 전)에 다른 프로세스가 파일을 옮긴다고 가정
    h_race = "race0002"
    p_race = mk(ws, h_race, "## Goal\n레이스 재현.\n")
    before = open(p_race, encoding="utf-8").read()
    moved_to = p_race.replace(T.IN_PROGRESS, ".done")

    real_ask_context = T.ask_context

    def moving_ask_context(*a, **kw):
        os.rename(p_race, moved_to)     # 읽기와 쓰기 사이에 티켓이 옮겨지는 순간을 재현한다
        return real_ask_context(*a, **kw)

    T.ask_context = moving_ask_context
    try:
        msg_race = T.ask_human(p_race, h_race, 3, "자동 회수", blocked=False)
    finally:
        T.ask_context = real_ask_context

    assert msg_race.startswith("ASK-FAIL {}".format(h_race)), \
        "race 경로가 ASK-FAIL을 안 냈다\n" + msg_race
    assert not os.path.exists(p_race), "옛 경로에 조각 파일이 새로 생겼다"
    tickets_dir = os.path.join(ws, "tickets")
    stems = [f for f in os.listdir(tickets_dir) if f.startswith(h_race)]
    assert stems == [os.path.basename(moved_to)], \
        "그 해시의 파일이 옮겨진 .done 하나뿐이어야 한다\n" + str(stems)
    after = open(moved_to, encoding="utf-8").read()
    assert after == before, "옮겨진 파일이 호출 전과 바이트가 달라졌다(부분 쓰기 흔적)\n" + after

    print("test_ask_human_race: ok")
finally:
    import shutil
    shutil.rmtree(ws, ignore_errors=True)
