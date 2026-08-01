#!/usr/bin/env python3
"""자동 상신 질문에 판단 재료가 붙는지 자체검증(ask_context). 실패하면 assert로 죽는다.

정형문 한 줄만 올라가던 시절 사람이 답할 자료가 화면에 없었다(요구 11990127).
Goal · 블록 · 죽은 세션 로그 꼬리 셋이 `## 질문 n` 절에 인용돼야 한다.
"""
import os
import json
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tickets as T


def iso(delta_sec):
    from datetime import datetime, timedelta
    return (datetime.now().astimezone() + timedelta(seconds=delta_sec)).isoformat(timespec="seconds")


def mk(troot, h, fm_lines, body):
    d = os.path.join(troot, "tickets")
    os.makedirs(d, exist_ok=True)
    p = os.path.join(d, h + T.IN_PROGRESS + ".md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("---\nticket: {}\nattempts: {}\nassigned_at: {}\n{}\n---\n\n{}".format(
            h, T.REAP_MAX_ATTEMPTS, iso(-T.REAP_GRACE_SEC - 60), "\n".join(fm_lines), body))
    return p


def rec(role, text):
    return json.dumps({"type": role, "message": {"role": role,
                                                 "content": [{"type": "text", "text": text}]}},
                      ensure_ascii=False) + "\n"


ws = tempfile.mkdtemp()
home = tempfile.mkdtemp()
old_home = os.environ.get("HOME")
os.environ["HOME"] = home            # transcript_of의 `~/.claude/projects` 탐색을 픽스처로 돌린다
try:
    # A) session_id로 트랜스크립트를 찾는 경로(fm `transcript:` 없음) + Goal + 블록
    sid = "deadbeef-1111-2222-3333-444455556666"
    tdir = os.path.join(home, ".claude", "projects", "-tmp-proj")
    os.makedirs(tdir)
    with open(os.path.join(tdir, sid + ".jsonl"), "w", encoding="utf-8") as f:
        f.write(rec("user", "이거 해줘"))
        f.write(rec("assistant", "인증서 오류로 죽습니다: SSL_ERROR_SYSCALL"))
        f.write("깨진 줄 — json 아님\n")          # 역순 파싱이 건너뛰어야 한다
    pa = mk(ws, "aaaa1111", ["session_id: " + sid],
            body="## Goal\n토큰 갱신을 고친다.\n\n## Done when\n- [ ] 돈다\n\n"
                 "## 블록\n인증서가 없어서 로그인이 안 된다.\n")

    # B) 트랜스크립트가 아예 없는 경우 + Goal 상한(600자)
    pb = mk(ws, "bbbb2222", ["session_id: nosuchsession-zzzz"],
            body="## Goal\n" + "G" * 700 + "\n")

    msgs = "\n".join(T.reap(ws))
    assert "ASK aaaa1111" in msgs and "ASK bbbb2222" in msgs, "상신 안 됨\n" + msgs

    a = open(os.path.join(ws, "tickets/aaaa1111.md"), encoding="utf-8").read()
    assert "## 질문 1" in a, "A: 질문 절이 없다\n" + a
    assert "자동 회수 3회 실패" in a, "A: 정형문 첫 줄이 바뀌었다\n" + a
    assert "### 티켓 Goal" in a and "> 토큰 갱신을 고친다." in a, "A: Goal 인용 없음\n" + a
    assert "Done when" not in a.split("### 티켓 Goal")[1].split("###")[0], "A: 다음 절까지 먹었다\n" + a
    assert "### 티켓 블록" in a and "> 인증서가 없어서" in a, "A: 블록 인용 없음\n" + a
    assert "### 죽은 세션 마지막 기록" in a, "A: 로그 절 없음\n" + a
    assert "SSL_ERROR_SYSCALL" in a, "A: 로그 꼬리 인용 없음\n" + a
    assert "이거 해줘" not in a, "A: 마지막 레코드가 아니라 앞 레코드를 붙였다\n" + a

    b = open(os.path.join(ws, "tickets/bbbb2222.md"), encoding="utf-8").read()
    assert "트랜스크립트를 찾지 못했습니다" in b, "B: 못 찾았다는 말이 없다\n" + b
    assert "### 티켓 블록" not in b, "B: 없는 절을 붙였다\n" + b
    assert "> " + "G" * 600 + "\n" in b, "B: Goal 600자 상한이 안 걸렸다"

    # C) 상한 나머지 둘 — 절 추출·인용은 A/B가 덮으므로 순수 함수로 확인한다
    assert T._section(["## 블록"] + ["x" * 2000], "블록", 1200) == "x" * 1200, "C: 블록 1200자"
    import unicodedata
    assert T._section([unicodedata.normalize("NFD", "## 블록"), "인증서 없음"], "블록", 99) \
        == "인증서 없음", "C: NFD 제목을 못 집는다"
    tp = os.path.join(home, "long.jsonl")
    with open(tp, "w", encoding="utf-8") as f:
        f.write(rec("assistant", "y" * 3000))
    assert T.transcript_tail(tp, 1500) == "[assistant] " + "y" * 1500, "C: 로그 1500자"
    # D) 경로 주입 — session_id에 glob/경로가 섞이면 아예 찾지 않는다
    assert T.transcript_of({"session_id": "../../*"}) == "", "D: glob 메타문자를 그대로 훑는다"
    assert T.transcript_tail("/tmp/없는파일-ask-context.jsonl") == "", "D: 없는 파일에 예외"

    print("PASS 4/4")
    print(a[a.index("## 질문 1"):])
finally:
    if old_home is None:
        os.environ.pop("HOME", None)
    else:
        os.environ["HOME"] = old_home
    shutil.rmtree(ws, ignore_errors=True)
    shutil.rmtree(home, ignore_errors=True)
