#!/usr/bin/env python3
"""`reap_release`가 `.done`을 되돌릴 때 답 없는 `awaiting` stem을 deps에서 빼는지(P437 결정 1).
자체검증 - 실패하면 assert로 죽는다.

실측(`e4bcae3c`, 2026-09-26): 세션이 답변 대기 티켓을 직접 풀고 `.done`으로 닫았는데 계획
상자 미점검(사유 `plan`)으로 되돌려지면, 되돌린 파일이 닫히기 전 잠금(`awaiting` stem이
`deps`에 남은 상태)을 그대로 들고 백로그로 간다. 그 stem 파일이 큐에 없으면(사람이 답할
생각이 없다) 영구히 멈춘다. `awaiting` 키는 남기고(GUI 판정은 deps로만 한다) deps만 뺀다.

넷 - (1) 답 파일 없음 -> deps에서 뺀다, awaiting은 남는다, 반환 문자열이 정해진 접미사로
끝난다 (2) 답 파일 있음 -> deps를 안 건드린다 (3) `.wip` 되돌림 -> deps를 안 건드린다.
"""
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tickets as T


def mk(troot, h, fm_lines, body="## Goal\n테스트\n\n## Done when\n- [ ] 하나\n", suffix=""):
    d = os.path.join(troot, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h + suffix + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\n{}\n---\n\n{}".format(h, "\n".join(fm_lines), body))
    return p


ws = tempfile.mkdtemp()
try:
    # (1) `.done` + `awaiting: X` + `deps: [Y, X]`이고 X 파일이 없다 -> reap_release(path,
    #     "plan") 뒤 열린 파일의 deps가 [Y]이고 awaiting: X는 남는다. 반환 문자열은
    #     ", 답 없는 잠금 X 해제"로 끝난다.
    p1 = mk(ws, "aaaa1111", ["awaiting: nosuchstem", "deps: [ffff9999, nosuchstem]"],
            suffix=T.DONE)
    mk(ws, "ffff9999", ["priority: 1"])  # deps에 남을 정상 stem - 실재한다
    out = T.reap_release(p1, "plan")
    open1 = os.path.join(ws, "tickets", "aaaa1111.md")
    assert os.path.exists(open1), "1: .done이 안 열렸다"
    fm1 = T.read_fm(open1)[0]
    assert fm1.get("deps", "").strip() == "[ffff9999]", \
        "1: deps에서 답 없는 stem이 안 빠졌다 - " + repr(fm1.get("deps"))
    assert fm1.get("awaiting", "").strip() == "nosuchstem", \
        "1: awaiting 키가 지워졌다 - " + repr(fm1.get("awaiting"))
    assert out.endswith(", 답 없는 잠금 nosuchstem 해제"), \
        "1: 반환 문자열이 정해진 접미사로 안 끝난다 - " + out

    # (2) 같은 조건인데 X 파일(`X.done.md`)이 있으면 deps가 안 바뀐다.
    p2 = mk(ws, "bbbb2222", ["awaiting: ccccstem", "deps: [ffff9999, ccccstem]"], suffix=T.DONE)
    mk(ws, "ccccstem", ["kind: answer"], suffix=T.DONE)  # 답 파일이 실재한다
    out2 = T.reap_release(p2, "plan")
    open2 = os.path.join(ws, "tickets", "bbbb2222.md")
    fm2 = T.read_fm(open2)[0]
    assert fm2.get("deps", "").strip() == "[ffff9999, ccccstem]", \
        "2: 답 파일이 있는데 deps가 바뀌었다 - " + repr(fm2.get("deps"))
    assert ", 답 없는 잠금" not in out2, "2: 답 파일이 있는데 해제 메시지를 냈다\n" + out2

    # (3) `.wip` 이름을 되돌리면 X 파일이 없어도 deps가 안 바뀐다(닫은 적 없으니 잠금 근거 0).
    p3 = mk(ws, "cccc3333", ["awaiting: nosuchstem2", "deps: [ffff9999, nosuchstem2]"],
            suffix=T.IN_PROGRESS)
    out3 = T.reap_release(p3, "plan")
    open3 = os.path.join(ws, "tickets", "cccc3333.md")
    fm3 = T.read_fm(open3)[0]
    assert fm3.get("deps", "").strip() == "[ffff9999, nosuchstem2]", \
        "3: .wip 되돌림인데 deps가 바뀌었다 - " + repr(fm3.get("deps"))
    assert ", 답 없는 잠금" not in out3, "3: .wip 되돌림인데 해제 메시지를 냈다\n" + out3

    print("PASS 4/4 - (1) 답 없는 stem 제거+awaiting 유지+반환 문자열 접미사 "
          "(2) 답 있으면 무변 (3) .wip 되돌림 무변")
finally:
    shutil.rmtree(ws, ignore_errors=True)
