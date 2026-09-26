#!/usr/bin/env python3
"""같은 해시에 조각과 완료본이 함께 있어도 `.done`이 이긴다(DESIGN.md §같은 해시에 파일이 둘
§결정 2) 자체검증. 실패하면 assert로 죽는다.

`_find_stem`이 `glob` 순서를 그대로 돌려주면 조각(fm 없는 열린 파일)이 완료본보다 먼저 잡혀
`deps_unmet`이 완료된 선행을 미완료로 오판한다 - 2026-09-25 12시간 멎음의 원인.
"""
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tickets as T


def mk_done(troot, h):
    d = os.path.join(troot, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h + T.DONE + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\nkind: work\n---\n\n## Goal\n테스트.\n".format(h))
    return p


def mk_fragment(troot, h):
    """fm 없는 조각 - `ask_human`이 남기던 사고 재현 형태."""
    d = os.path.join(troot, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("## 질문 1\n\n조각.\n")
    return p


def mk_dependent(troot, h, dep):
    d = os.path.join(troot, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\nkind: work\ndeps: [{}]\n---\n\n## Goal\n테스트.\n".format(h, dep))
    return p


def open_hashes(rows):
    return {r["hash"] for r in rows}


# 수용조건 4 - X.done.md와 X.md(조각)를 함께 두면 find가 done을 낸다, deps: [X]인 Y가 select에 뜬다.
# 순서 A: done 먼저, 조각 나중
ws = tempfile.mkdtemp()
try:
    mk_done(ws, "aaaa0001")
    mk_fragment(ws, "aaaa0001")
    mk_dependent(ws, "bbbb0002", "aaaa0001")

    hit = T.find_any(ws, "aaaa0001")
    assert hit is not None and hit.endswith(T.DONE + ".md"), \
        "done+조각 순서 A에서 find가 done을 안 냈다: " + str(hit)

    rows = T.scan(ws)
    assert "bbbb0002" in open_hashes(rows), \
        "순서 A에서 deps: [aaaa0001]인 열린 티켓이 select에 안 나왔다: " + str(rows)
finally:
    shutil.rmtree(ws, ignore_errors=True)

# 순서 B: 조각 먼저, done 나중(만드는 순서를 바꿔도 같아야 한다)
ws = tempfile.mkdtemp()
try:
    mk_fragment(ws, "aaaa0001")
    mk_done(ws, "aaaa0001")
    mk_dependent(ws, "bbbb0002", "aaaa0001")

    hit = T.find_any(ws, "aaaa0001")
    assert hit is not None and hit.endswith(T.DONE + ".md"), \
        "done+조각 순서 B에서 find가 done을 안 냈다: " + str(hit)

    rows = T.scan(ws)
    assert "bbbb0002" in open_hashes(rows), \
        "순서 B에서 deps: [aaaa0001]인 열린 티켓이 select에 안 나왔다: " + str(rows)
finally:
    shutil.rmtree(ws, ignore_errors=True)

# 수용조건 5 - X.wip.md와 X.md만 있으면 find가 wip을 낸다.
ws = tempfile.mkdtemp()
try:
    d = os.path.join(ws, "tickets")
    os.makedirs(d, exist_ok=True)
    wip_p = os.path.join(d, "cccc0003" + T.IN_PROGRESS + ".md")
    with open(wip_p, "w", encoding="utf-8") as f:
        f.write("---\nticket: cccc0003\nkind: work\n---\n\n## Goal\n테스트.\n")
    mk_fragment(ws, "cccc0003")

    hit = T.find_any(ws, "cccc0003")
    assert hit is not None and hit.endswith(T.IN_PROGRESS + ".md"), \
        "wip+조각에서 find가 wip을 안 냈다: " + str(hit)
finally:
    shutil.rmtree(ws, ignore_errors=True)

print("OK test_find_stem_priority.py")
