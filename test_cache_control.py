#!/usr/bin/env python3
"""캐시 갈래(P295-10) 자체검증: 스트리밍 프라임 JSON의 `content`가 블록 둘로 갈리는가.

앞 블록(안 변하는 문서 층 - CORE.md - 페르소나 - 온톨로지 - 큐 AGENTS.md)에만
`cache_control:{"type":"ephemeral","ttl":"1h"}`가 있고, 뒤 블록(변하는 꼬리 - 티켓 해시 문장 -
참조 컨텍스트 - 언어 안내)에는 없다. 두 블록 text를 이어 붙인 것이 `dryrun`이 찍는 프롬프트와
바이트 단위로 같아야 한다(§프롬프트 층 결정 10 §엔진 수정 스물다섯 번째 승인).

임시 큐에서만 판정한다(도그푸딩 큐에서 엔진을 실험하지 않는다). 진짜 claude를 부르지 않고,
stdin 첫 줄(프라임 JSON)을 파일로 받아 적는 가짜 스트림 엔진으로 본다(test_inbox.py 선례).
실패하면 assert로 죽는다.
"""
import os
import json
import shutil
import tempfile
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))

WORKER = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/fake-stream.sh" "{{sid}}" "--input-format" "stream-json")
. "{tick}"
"""

# 첫 줄(프라임 JSON)을 파일로 떠 두고 init -> result를 뱉는다 - 진짜 엔진의 stdin을 훔쳐보는
# 대신 엔진 스스로 받아 적게 한다(PRIMEF는 워커 종료 trap에서 지워지므로 디스크에서 훔쳐 읽으면
# 경합이 생긴다 - test_inbox.py와 같은 이유).
ENGINE = """\
#!/bin/bash
IFS= read -r first
printf '%s\\n' "$first" > "{tmp}/captured-prime.jsonl"
printf '{{"type":"system","subtype":"init"}}\\n'
printf '{{"is_error":false,"num_turns":1,"session_id":"%s","type":"result","subtype":"success"}}\\n' "$1"
sleep 60
"""


def write(path, body):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    return path


def dryrun(worker, local):
    r = subprocess.run([worker, "dryrun"], capture_output=True, text=True,
                       env=dict(os.environ, TICKET_LOCAL=local), timeout=60)
    assert r.returncode == 0, "dryrun rc={}\n{}{}".format(r.returncode, r.stdout, r.stderr)
    return r.stdout


def prompt_of(dryrun_stdout):
    # dryrun의 마지막 echo가 "프롬프트: $PROMPT"다 - 그 뒤 전부가 프롬프트고, echo 자신이
    # 붙인 마지막 개행 한 글자만 걷어낸다(PROMPT 자체는 개행으로 안 끝난다).
    marker = "프롬프트: "
    assert marker in dryrun_stdout, "dryrun 출력에 프롬프트 표시가 없다\n" + dryrun_stdout
    tail = dryrun_stdout.split(marker, 1)[1]
    assert tail.endswith("\n"), "dryrun 프롬프트 뒤에 echo 개행이 없다"
    return tail[:-1]


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    # 엔진 사본 - tick.sh는 자기 위치에서 tickets.py와 protocols/를 유도한다(tick.sh:19).
    code = os.path.join(tmp, "engine")
    os.makedirs(code)
    for f in ("tick.sh", "tickets.py"):
        shutil.copy2(os.path.join(HERE, f), os.path.join(code, f))
    tick = os.path.join(code, "tick.sh")

    root = os.path.join(tmp, "dira")
    local = os.path.join(tmp, "local")
    os.makedirs(local)
    write(os.path.join(code, "protocols", "CORE.md"), "# 코어\n코어-마커\n")
    write(os.path.join(root, "protocols", "AGENTS.md"), "# 협업\nAGENTS-마커\n")
    write(os.path.join(root, "personas", "dev", "PROFILE.md"), "# Dev\n페르소나-마커\n")
    write(os.path.join(root, "ontology", "_ontology", "SCHEMA.md"), "# 지도\n온톨로지-마커\n")
    write(os.path.join(root, "tickets", "c0c00001.md"),
          "---\nticket: c0c00001\ntitle: t\nkind: work\npersona: dev\n---\n\n## Goal\ntest\n")
    write(os.path.join(tmp, "fake-stream.sh"), ENGINE.format(tmp=tmp))
    os.chmod(os.path.join(tmp, "fake-stream.sh"), 0o755)
    worker = write(os.path.join(root, "workers", "w.sh"),
                   WORKER.format(name="w", tmp=tmp, tick=tick))
    os.chmod(worker, 0o755)

    full_prompt = prompt_of(dryrun(worker, local))
    for marker in ("코어-마커", "페르소나-마커", "===== 온톨로지 (", "AGENTS-마커",
                   "please pick up c0c00001"):
        assert marker in full_prompt, "dryrun 프롬프트에 " + marker + "가 없다\n" + full_prompt

    # 티켓을 다시 백로그로 되돌려 실행용으로 재사용한다(dryrun은 claim을 안 남기지만 방어적으로).
    assert not os.path.exists(os.path.join(root, "tickets", "c0c00001.wip.md"))

    r = subprocess.run([worker, "tick"], capture_output=True, text=True,
                       env=dict(os.environ, TICKET_LOCAL=local), timeout=90)
    assert r.returncode == 0, "tick rc={}\n{}{}".format(r.returncode, r.stdout, r.stderr)

    captured_path = os.path.join(tmp, "captured-prime.jsonl")
    assert os.path.exists(captured_path), "가짜 엔진이 프라임 줄을 못 받았다"
    with open(captured_path, encoding="utf-8") as f:
        line = f.read().strip()
    prime = json.loads(line)

    assert prime.get("type") == "user", prime
    content = prime.get("message", {}).get("content")
    assert isinstance(content, list) and len(content) == 2, \
        "content가 블록 둘인 배열이 아니다: {}".format(content)
    head_block, tail_block = content

    assert head_block.get("type") == "text", head_block
    assert tail_block.get("type") == "text", tail_block
    assert head_block.get("cache_control") == {"type": "ephemeral", "ttl": "1h"}, \
        "앞 블록 cache_control이 다르다: {}".format(head_block.get("cache_control"))
    assert "cache_control" not in tail_block, \
        "뒤 블록에 cache_control이 있으면 안 된다: {}".format(tail_block)

    head, tail = head_block["text"], tail_block["text"]
    assert head.startswith("===== CORE.md"), "앞 블록이 CORE.md로 안 시작한다\n" + head[:200]
    assert head.rstrip().endswith("===== 프로토콜 끝 ====="), \
        "앞 블록이 큐 AGENTS.md 프로토콜 끝으로 안 끝난다\n" + head[-200:]
    assert tail.startswith("please pick up c0c00001"), \
        "뒤 블록이 티켓 해시 문장으로 안 시작한다\n" + tail[:200]
    assert tail.rstrip().endswith("그 지침을 따르세요."), \
        "뒤 블록이 언어 안내로 안 끝난다\n" + tail[-200:]
    # 한국어 문장 지침은 안 변하는 6KB 상수라 앞 블록(캐시되는 문서 층)에 있다 - 꼬리로
    # 새면 회차마다 캐시 밖에서 다시 쓰인다(이 절이 막는 회귀가 정확히 그것이다).
    assert "===== 한국어 문장 지침" in head and "===== 한국어 문장 지침" not in tail, \
        "한국어 문장 지침 블록이 앞 블록에 없다(또는 꼬리로 샜다)"

    assert head + tail == full_prompt, \
        "두 블록을 이어 붙인 것이 dryrun 프롬프트와 다르다\n--- head+tail\n{}\n--- dryrun\n{}".format(
            head + tail, full_prompt)

    print("PASS 프라임 JSON 블록 둘 + 앞 블록만 cache_control ttl 1h + head+tail == dryrun 프롬프트")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
