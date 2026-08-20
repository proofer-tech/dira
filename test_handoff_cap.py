#!/usr/bin/env python3
"""이어받기 3회 상한(DESIGN.md 결정 6) 자체검증. 실패하면 assert로 죽는다.

핸드오프 사슬이 무한히 길어지면 재디스패치가 영원한 재디스패치가 된다. `handoffs: <n>`이
상한(3)을 넘긴 티켓은 claim이 실패하고 답변 대기로 올라간다 - 판정 자리는 `tickets.py`
`claim`, 원자적 link에 **성공한 뒤**다. 임시 큐(제약 1 - 실제 큐를 안 건드린다)에서 낸다.
"""
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tickets as T


def mk(troot, h, handoffs=None, extra_fm=""):
    d = os.path.join(troot, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h + ".md")
    fm = "handoffs: {}\n".format(handoffs) if handoffs is not None else ""
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\nkind: work\n{}{}---\n\n## Goal\n테스트.\n".format(h, fm, extra_fm))
    return p


ws = tempfile.mkdtemp()
try:
    # ③ handoffs: 4 (상한 3 초과) - claim 실패, 열린 채 `## 질문 n` + awaiting + 존재하지 않는 dep
    p = mk(ws, "aaaa0001", handoffs=4)
    try:
        T.claim(p)
        assert False, "handoffs 4는 claim이 성공하면 안 된다"
    except SystemExit as e:
        assert "이어받기가 3회를 넘었습니다" in str(e), "SystemExit 사유가 다르다: " + str(e)

    back = os.path.join(ws, "tickets", "aaaa0001.md")
    assert os.path.exists(back), "claim 실패 뒤 백로그 이름으로 안 돌아왔다"
    assert not os.path.exists(os.path.join(ws, "tickets", "aaaa0001" + T.IN_PROGRESS + ".md")), \
        ".wip이 그대로 남았다"
    body = open(back, encoding="utf-8").read()
    assert "## 질문 1" in body, "질문 절이 안 붙었다\n" + body
    assert "이어받기가 3회를 넘었습니다" in body, "본문에 사유가 없다\n" + body
    # 개정 2 (1) - 물음은 회수 실패 갈래("세션이 왜 계속 죽는지")가 아니라 범위를 묻는 한 줄이다
    assert "남은 범위가 한 세션에 드는지, 이 티켓을 그대로 더 갈지 답해주세요." in body, \
        "handoff 물음이 스펙 문장과 다르다\n" + body
    assert "세션이 왜 계속 죽는지" not in body, "handoff 카드가 회수 실패 물음을 그대로 썼다\n" + body
    # 개정 2 (2) - 죽은 세션이 없는 갈래라 그 절을 안 붙인다. 티켓 Goal은 붙는다
    assert "### 죽은 세션 마지막 기록" not in body, "handoff 카드에 없는 사고의 로그 절이 붙었다\n" + body
    assert "### 티켓 Goal" in body and "> 테스트." in body, "handoff 카드에 티켓 Goal이 안 붙었다\n" + body
    fm_a, lines_a, end_a = T.read_fm(back)
    awaiting = (fm_a.get("awaiting") or "").strip()
    assert awaiting, "awaiting이 안 걸렸다\n" + str(fm_a)
    deps = T.deps_of(lines_a, end_a)
    assert awaiting in deps, "존재하지 않는 dep(awaiting)이 안 걸렸다: " + str(deps)
    assert not T._find_stem(ws, awaiting), "awaiting dep이 실제로 존재하는 티켓이다(가짜 dep이어야 한다)"

    # ④ 위 티켓을 다시 claim하면 성공하고 `## 질문` 절이 한 벌 그대로다(awaiting 가드)
    dst = T.claim(back)
    assert dst.endswith(T.IN_PROGRESS + ".md"), "재claim이 실패했다: " + dst
    body2 = open(dst, encoding="utf-8").read()
    assert body2.count("## 질문") == 1, "재claim에서 질문 절이 또 붙었다\n" + body2
    T.release(dst)  # 뒷정리 - 다음 케이스와 안 섞이게

    # ⑤ handoffs: 3(상한 이내) - claim 종전대로 성공(회귀 자리)
    p3 = mk(ws, "bbbb0002", handoffs=3)
    dst3 = T.claim(p3)
    assert dst3.endswith(T.IN_PROGRESS + ".md"), "handoffs 3은 claim이 성공해야 한다: " + dst3
    body3 = open(dst3, encoding="utf-8").read()
    assert "## 질문" not in body3, "handoffs 3인데 답변 대기로 올라갔다\n" + body3

    # ⑤ 키 없음(0으로 읽음) - claim 종전대로 성공(회귀 자리)
    p4 = mk(ws, "cccc0003")
    dst4 = T.claim(p4)
    assert dst4.endswith(T.IN_PROGRESS + ".md"), "handoffs 없음은 claim이 성공해야 한다: " + dst4
    body4 = open(dst4, encoding="utf-8").read()
    assert "## 질문" not in body4, "handoffs 없는 티켓이 답변 대기로 올라갔다\n" + body4

    # ask_human 사유 문구 - 고정 벌 + default_answer는 종전 그대로(회귀 자리)
    for opt in ("- (a) 다시 시도한다", "- (b) 내가 손보고 나서 다시 시도한다",
                "- (c) 그만둔다", "- (d) 아래 칸에 직접 쓴다"):
        assert opt in body, "고정 선택지 누락 - " + opt
    assert fm_a.get("default_answer") == "1.(a)", "default_answer가 종전과 다르다\n" + str(fm_a)

    # ⑥ 개정 2 (4) - 나머지 세 갈래(회수 실패 - 블록 - 강제 중단)의 카드는 한 글자도 안 갈린다
    p5 = mk(ws, "dddd0004")
    T.ask_human(p5, "dddd0004", 3, "SSL_ERROR", blocked=False, killed=False, handoff=False)
    body5 = open(p5, encoding="utf-8").read()
    assert "자동 회수 3회 실패(SSL_ERROR)" in body5, "회수 실패 사유 문구가 갈렸다\n" + body5
    assert "세션이 왜 계속 죽는지, 이 티켓을 계속 갈지 답해주세요." in body5, \
        "회수 실패 물음이 갈렸다\n" + body5
    assert "### 죽은 세션 마지막 기록" in body5, "회수 실패 갈래에서 로그 절이 없어졌다\n" + body5

    p6 = mk(ws, "eeee0005")
    T.ask_human(p6, "eeee0005", 0, "", blocked=True)
    body6 = open(p6, encoding="utf-8").read()
    assert "세션이 `## 블록`을 남기고 멈췄습니다" in body6, "블록 사유 문구가 갈렸다\n" + body6
    assert "### 죽은 세션 마지막 기록" in body6, "블록 갈래에서 로그 절이 없어졌다\n" + body6

    p7 = mk(ws, "ffff0006")
    T.ask_human(p7, "ffff0006", 0, "", killed=True)
    body7 = open(p7, encoding="utf-8").read()
    assert "사람이 강제 중단했습니다" in body7, "강제 중단 사유 문구가 갈렸다\n" + body7
    assert "이 티켓을 계속 갈지, 무엇을 바꿔서 갈지 답해주세요." in body7, \
        "강제 중단 물음이 갈렸다\n" + body7
    assert "### 죽은 세션 마지막 기록" in body7, "강제 중단 갈래에서 로그 절이 없어졌다\n" + body7

    print("PASS 6/6 - 이어받기 3회 상한(claim 실패/재claim/회귀 둘/ask_human 사유/나머지 세 갈래 회귀)")
finally:
    shutil.rmtree(ws, ignore_errors=True)
