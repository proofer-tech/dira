#!/usr/bin/env python3
"""캐시 갈래(P295-10) 자체검증: 안 변하는 문서 층이 캐시되는 자리로 가는가.

2026-08-28 개정 - 단언이 뒤집힌 자리와 그 이유:
    옛 계약은 "프라임 JSON의 content가 블록 둘로 갈리고 앞 블록에만 cache_control ttl 1h가
    있다"였다. 지금 계약은 "프라임은 꼬리 한 블록이고 cache_control이 하나도 없다. 문서 층은
    `--append-system-prompt`로 간다"다.
    이 파일이 우리 블록 1개만 재고 CLI 몫과의 합은 안 재는 것이 사각지대였다 - 그 합이 API
    상한 4를 넘어도 여기서는 초록이었다.
    실측(로컬 기록 API로 요청 본문을 떠서 셈): CLI가 자기 몫으로 최대 4개를 쓴다 - system 둘
    (에이전트 프롬프트 - 하네스 프롬프트) + 대화 롤링 둘. 롤링 창은 도구 결과가 붙는 **둘째**
    요청부터 2개가 된다. 그래서 우리가 한 개라도 달면 첫 턴은 4로 통과하고 둘째 턴에서 5가 되어
    세션이 통째로 400을 받는다("A maximum of 4 blocks with cache_control may be provided.
    Found 5."). 그 400이 api_error로 읽혀 쿨다운을 걸고, 만료 직전 나간 워커가 또 400을 받아
    창을 되감아 2026-08-28 04:50~11:07 큐가 멎었다(실패 세션 14건).
    우리 몫을 0으로 내려야 합이 4 이하다 - 우리가 줄일 수 있는 유일한 몫이 우리 것뿐이다.
    그러면서 P295 이득은 지킨다: `--append-system-prompt`로 넘긴 텍스트를 CLI가 자기 시스템
    블록 **끝에** 이어 붙이는데 그 블록에는 CLI 자기 cache_control ttl 1h가 이미 달려 있다.
    우리 블록을 하나도 안 쓰고 문서 층이 캐시 프리픽스 안에 들어간다(붙인 뒤에도 총 개수는
    턴1 3 - 턴2 4). 옛 자리보다 오래 사는 캐시다 - 옛 자리는 매 커밋마다 갈리는 gitStatus
    리마인더 뒤였는데 시스템 블록은 그 앞이다.

이어 붙인 것이 프롬프트 전부라는 계약은 그대로다: argv의 문서 층 + 프라임 꼬리가 `dryrun`이
찍는 프롬프트와 바이트 단위로 같아야 한다(§프롬프트 층 결정 10 §엔진 수정 스물다섯 번째 승인 개정).

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
printf '%s\\0' "$@" > "{tmp}/captured-argv"
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
    assert isinstance(content, list) and len(content) == 1, \
        "content가 꼬리 한 블록인 배열이 아니다: {}".format(content)
    tail_block = content[0]
    assert tail_block.get("type") == "text", tail_block
    # 우리 몫은 0이다. 한 블록이라도 달면 CLI 몫 4와 합쳐 5가 되어 둘째 요청이 400으로 죽는다.
    assert "cache_control" not in tail_block, \
        "프라임 블록에 cache_control이 있으면 안 된다(CLI 몫 4와 합쳐 API 상한 4를 넘는다): {}".format(
            tail_block)

    # 문서 층은 argv로 간다 - `--append-system-prompt <HEAD>`가 인자 **둘**로 인접해 있어야 한다.
    with open(os.path.join(tmp, "captured-argv"), encoding="utf-8") as f:
        argv = f.read().split("\0")[:-1]
    assert "--append-system-prompt" in argv, \
        "엔진 argv에 --append-system-prompt가 없다: {}".format(argv[:6])
    i = argv.index("--append-system-prompt")
    assert i + 1 < len(argv), "--append-system-prompt 뒤에 값이 없다: {}".format(argv)
    head = argv[i + 1]
    assert argv.count("--append-system-prompt") == 1, \
        "--append-system-prompt가 두 번 붙었다(문서 층이 두 벌 간다): {}".format(argv)

    tail = tail_block["text"]
    assert head.startswith("===== CORE.md"), "문서 층이 CORE.md로 안 시작한다\n" + head[:200]
    assert head.rstrip().endswith("===== 프로토콜 끝 ====="), \
        "문서 층이 큐 AGENTS.md 프로토콜 끝으로 안 끝난다\n" + head[-200:]
    assert tail.startswith("please pick up c0c00001"), \
        "프라임 블록이 티켓 해시 문장으로 안 시작한다\n" + tail[:200]
    assert tail.rstrip().endswith("그 지침을 따르세요."), \
        "프라임 블록이 언어 안내로 안 끝난다\n" + tail[-200:]
    # 한국어 문장 지침은 안 변하는 6KB 상수라 문서 층(캐시되는 쪽)에 있다 - 꼬리로 새면
    # 회차마다 캐시 밖에서 다시 쓰인다(이 절이 막는 회귀가 정확히 그것이다).
    assert "===== 한국어 문장 지침" in head and "===== 한국어 문장 지침" not in tail, \
        "한국어 문장 지침 블록이 문서 층에 없다(또는 꼬리로 샜다)"
    # 문서 층이 프라임으로도 새면 같은 것이 두 벌 간다(토큰 두 배 + 캐시 무의미).
    assert "===== CORE.md" not in tail, "문서 층이 프라임 블록으로 샜다\n" + tail[:200]

    assert head + tail == full_prompt, \
        "argv 문서 층 + 프라임 꼬리가 dryrun 프롬프트와 다르다\n--- head+tail\n{}\n--- dryrun\n{}".format(
            head + tail, full_prompt)

    # --- en 경로(§0-16 §주입 §개정 5) - 지침 블록이 0바이트라 위 두 단언(head-tail 분리 -
    # 블록이 앞 블록에 있다)의 대상 자체가 없다. 부재가 이 판정을 깨지 않는지를 본다.
    langfile = os.path.join(local, "language.json")
    write(langfile, json.dumps({"locale": "en"}))
    write(os.path.join(root, "tickets", "c0c00002.md"),
          "---\nticket: c0c00002\ntitle: t\nkind: work\npersona: dev\n---\n\n## Goal\ntest\n")

    full_prompt_en = prompt_of(dryrun(worker, local))
    assert "===== 한국어 문장 지침" not in full_prompt_en, \
        "en인데 지침 블록이 여전히 실렸다\n" + full_prompt_en

    r = subprocess.run([worker, "tick"], capture_output=True, text=True,
                       env=dict(os.environ, TICKET_LOCAL=local), timeout=90)
    assert r.returncode == 0, "en tick rc={}\n{}{}".format(r.returncode, r.stdout, r.stderr)

    with open(captured_path, encoding="utf-8") as f:
        prime_en = json.loads(f.read().strip())
    content_en = prime_en.get("message", {}).get("content")
    assert isinstance(content_en, list) and len(content_en) == 1, \
        "en content가 꼬리 한 블록인 배열이 아니다: {}".format(content_en)
    tail_block_en = content_en[0]
    assert "cache_control" not in tail_block_en, \
        "en 프라임 블록에 cache_control이 있으면 안 된다: {}".format(tail_block_en)

    with open(os.path.join(tmp, "captured-argv"), encoding="utf-8") as f:
        argv_en = f.read().split("\0")[:-1]
    assert argv_en.count("--append-system-prompt") == 1, \
        "en에서 --append-system-prompt가 중복되거나 없다: {}".format(argv_en)
    head_en = argv_en[argv_en.index("--append-system-prompt") + 1]
    tail_en = tail_block_en["text"]

    assert "===== 한국어 문장 지침" not in head_en and "===== 한국어 문장 지침" not in tail_en, \
        "en인데 지침 블록이 문서 층 또는 꼬리에 실렸다(부재여야 한다)"
    assert head_en + tail_en == full_prompt_en, \
        "en argv 문서 층 + 프라임 꼬리가 dryrun 프롬프트와 다르다"
    assert "keep every written deliverable in english" in tail_en.lower(), \
        "en 산출물 영어 고정 짝이 프라임 꼬리에 안 실렸다\n" + tail_en

    print("PASS 문서 층은 --append-system-prompt로 · 프라임은 꼬리 한 블록 · cache_control 0개(우리 몫) "
          "· head+tail == dryrun 프롬프트 · en 경로는 지침 블록 부재로도 판정이 안 깨진다")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
