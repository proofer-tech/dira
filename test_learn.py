#!/usr/bin/env python3
"""learn.py 자체검증: 실패->성공 상관과 memory 중복 배제가 맞물리는가.

LLM 호출(call_llm)은 네트워크라 여기서 안 돈다 - 재는 것은 그 앞의 결정적 추출뿐이다.
실패하면 assert로 죽는다.
"""
import json
import os
import shutil
import tempfile

import learn


def write_jsonl(path, records):
    with open(path, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def tool_use(id_, name, inp):
    return {"type": "assistant", "message": {"content": [{"type": "tool_use", "id": id_, "name": name, "input": inp}]}}


def tool_result(id_, is_error, text):
    return {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": id_, "is_error": is_error, "content": text}]}}


tmp = tempfile.mkdtemp()
try:
    session = os.path.join(tmp, "s1.jsonl")
    write_jsonl(session, [
        {"type": "queue-operation", "content": "당신은 이 프로젝트의 'developer'입니다\n... tickets/53daf192.wip.md 읽는다 ..."},
        tool_use("t1", "Read", {"file_path": "/repo/A.md"}),
        tool_result("t1", True, "파일 없음"),
        tool_use("t2", "Bash", {"command": "ls .dira"}),
        tool_result("t2", False, "tickets\nworkers"),
        tool_use("t3", "Read", {"file_path": "/repo/B.md"}),
        tool_result("t3", False, "본문"),
    ])

    # 1) 페르소나 · 티켓 해시 추출
    persona, h = learn.session_meta(session)
    assert persona == "developer", persona
    assert h == "53daf192", h

    # 2) 도구 이벤트가 순서대로 펴진다 - 3개, 실패는 첫 Read 하나
    events = learn.load_tool_events(session)
    assert [e["name"] for e in events] == ["Read", "Bash", "Read"], events
    assert events[0]["is_error"] is True
    assert events[1]["is_error"] is False and events[2]["is_error"] is False

    # 3) 실패 Read -> 나중 성공 Read로 짝짓는다. 사이의 Bash 성공은 다른 도구라 무시
    pairs = learn.find_pairs(events)
    assert len(pairs) == 1, pairs
    assert pairs[0]["tool"] == "Read"
    assert pairs[0]["fail_input"].endswith("A.md")
    assert pairs[0]["ok_input"].endswith("B.md")
    assert pairs[0]["gap"] == 2

    # 4) 실패 뒤에 같은 도구의 성공이 없으면 쌍이 안 생긴다(실패 목록으로 새지 않는다)
    only_fail = [{"name": "Grep", "input": {"pattern": "x"}, "is_error": True, "result": "err"}]
    assert learn.find_pairs(only_fail) == []

    # 5) memory grep 중복 배제: 파일명이 이미 memory 본문에 있으면 버린다
    assert learn.already_known(pairs[0], "예전에 A.md가 없어서 헤맸다") is True
    assert learn.already_known(pairs[0], "이 memory는 무관한 내용뿐") is False
    assert learn.already_known(pairs[0], "") is False

    print("PASS 페르소나/해시 추출 - 도구 이벤트 순서 - 실패->성공 짝짓기 - 근거없는 실패 배제 - memory grep 중복 배제")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
