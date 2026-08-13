#!/usr/bin/env python3
"""graph.py build 자체검증: 노드 6종-간선(deps/req/archives/awaiting/인용/위키링크/절참조/
근거/구현/links:) 이 §그래프 탐색 §노드와 간선 표대로 서는가, 증분 빌드가 안 바뀐 파일을
다시 안 읽는가, 큐(티켓 frontmatter)를 안 건드리는가, 인덱스가 없어도 tick.sh가 WARN 없이
도는가(검증 ⑧). 실패하면 assert로 죽는다.

docs/DESIGN.md §그래프 탐색 §검증.
"""
import json
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GRAPH = os.path.join(HERE, "graph.py")
TICK = os.path.join(HERE, "tick.sh")

WORKER = """\
#!/bin/bash
TICKET_NAME="{name}"
TICKET_CWD="{tmp}"
TICKET_PROMPT_FMT="please pick up %s"
TICKET_ENGINE=("{tmp}/claude" "{{prompt}}")
. "{tick}"
"""


def write(path, body):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)
    return path


def build(root, force=False):
    args = ["python3", GRAPH, "build", root] + (["--force"] if force else [])
    r = subprocess.run(args, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, "build rc={}\n{}{}".format(r.returncode, r.stdout, r.stderr)
    return r.stdout


def load(root):
    return json.load(open(os.path.join(root, "graph.json"), encoding="utf-8"))


def links_by_rel(g):
    out = {}
    for e in g["links"]:
        out.setdefault(e["rel"], []).append(e)
    return out


tmp = os.path.realpath(tempfile.mkdtemp())
try:
    root = os.path.join(tmp, "dira")

    # ---- 픽스처: 티켓 셋 + 온톨로지 객체 + 메모리 + 프로토콜 + 스펙(큐의 부모 docs/) ----
    write(os.path.join(root, "tickets", "aaaaaaaa.md"),
          "---\nticket: aaaaaaaa\ntitle: 선행\nkind: work\n---\n\n## Goal\n선행 티켓\n")
    write(os.path.join(root, "tickets", "bbbbbbbb.md"),
          "---\nticket: bbbbbbbb\ntitle: 인용 대상\nkind: work\n---\n\n## Goal\n인용 대상 티켓\n")
    write(os.path.join(root, "tickets", "11111111.wip.md"),
          "---\nticket: 11111111\ntitle: 본진\nkind: work\n"
          "deps: [aaaaaaaa]\nreq: aaaaaaaa\narchives: bbbbbbbb\nawaiting: bbbbbbbb\n---\n\n"
          "## Goal\n`bbbbbbbb`를 인용하고 [[샘플기능]]을 걸고 §그래프 규칙을 참조한다\n")
    write(os.path.join(root, "ontology", "objects", "기능", "샘플기능.md"),
          "---\ntype: 기능\nname: 샘플기능\naliases: []\ntags: []\n"
          "description: 샘플 온톨로지 객체\n"
          "근거:\n  - aaaaaaaa\n"
          "구현:\n  - lib/sample.ts (설명)\n"
          "links:\n  돌린다:\n    - 다른개념: \"[[다른개념]]\"\n---\n\n"
          "# 샘플기능\n본문에서 [[다른개념]]을 또 참조하고 `bbbbbbbb`도 인용한다\n")
    write(os.path.join(root, "personas", "dev", "memory", "개념.md"),
          "# 개념\n[[샘플기능]]을 참고한다\n")
    write(os.path.join(root, "protocols", "AGENTS.md"),
          "# 프로토콜\n아무 내용 - `aaaaaaaa` 인용\n")
    write(os.path.join(root, "..", "docs", "DESIGN.md"),
          "# 테스트 스펙\n\n## 검증\n검증 절 본문.\n\n## 그래프 규칙\n§검증을 인용한다.\n\n"
          "## 중복\n첫 번째.\n\n## 중복\n두 번째.\n")

    # ---- 1) build 콜드 -> 노드 6종 전부 서고, 표의 간선이 전부 만들어진다 ----
    out = build(root, force=True)
    assert "OK build" in out, "요약 줄이 안 찍혔다\n" + out
    g = load(root)
    types = {n["type"] for n in g["nodes"]}
    assert types == {"티켓", "스펙 절", "온톨로지 객체", "메모리", "프로토콜 문서", "소스 파일"}, \
        "노드 6종이 안 맞다: {}".format(types)

    rels = links_by_rel(g)
    assert any(e["source"] == "11111111" and e["target"] == "aaaaaaaa" for e in rels.get("deps", [])), rels
    assert any(e["source"] == "11111111" and e["target"] == "aaaaaaaa" for e in rels.get("req", [])), rels
    assert any(e["source"] == "11111111" and e["target"] == "bbbbbbbb" for e in rels.get("archives", [])), rels
    assert any(e["source"] == "11111111" and e["target"] == "bbbbbbbb" for e in rels.get("awaiting", [])), rels
    assert any(e["source"] == "11111111" and e["target"] == "bbbbbbbb" for e in rels.get("인용", [])), rels
    assert any(e["source"] == "11111111" and e["target"] == "샘플기능" for e in rels.get("위키링크", [])), rels
    assert any(e["source"] == "11111111" and e["target"] == "DESIGN#그래프 규칙" for e in rels.get("절참조", [])), rels
    assert any(e["source"] == "샘플기능" and e["target"] == "aaaaaaaa" for e in rels.get("근거", [])), rels
    assert any(e["source"] == "샘플기능" and e["target"] == "lib/sample.ts" for e in rels.get("구현", [])), rels
    assert any(e["source"] == "샘플기능" and e["target"] == "다른개념" for e in rels.get("돌린다", [])), rels
    assert any(n["id"] == "lib/sample.ts" and n["type"] == "소스 파일" for n in g["nodes"]), g["nodes"]
    # 중복 제목 -> 뒤엣것은 #2로 갈린다(§노드와 간선 - 같은 제목 54쌍 실측과 같은 처리)
    spec_ids = {n["id"] for n in g["nodes"] if n["type"] == "스펙 절"}
    assert "DESIGN#중복" in spec_ids and "DESIGN#중복#2" in spec_ids, spec_ids

    # ---- 2) 검증① - graph.py 자기 import 줄이 표준 라이브러리 밖으로 안 나간다 ----
    import re as _re
    allow = _re.compile(r"\b(json|os|re|sys|time|math|pathlib|argparse|collections|unicodedata|difflib)\b")
    bad = [l for l in open(GRAPH, encoding="utf-8") if _re.match(r"^\s*(import|from)\s", l) and not allow.search(l)]
    assert bad == [], "표준 라이브러리 밖 import: {}".format(bad)

    # ---- 3) 검증⑦ - 큐(티켓 frontmatter)를 안 건드린다 ----
    before = open(os.path.join(root, "tickets", "11111111.wip.md"), encoding="utf-8").read()
    build(root)
    after = open(os.path.join(root, "tickets", "11111111.wip.md"), encoding="utf-8").read()
    assert before == after, "빌드가 티켓 본문을 바꿨다"
    assert os.path.isfile(os.path.join(root, "tickets", "11111111.wip.md")), "파일명이 갈렸다"

    # ---- 4) 증분 - 안 바뀐 재빌드는 changed=0, 파일 하나 수정은 그 한 장만 다시 읽는다 ----
    out = build(root)
    assert "changed=0" in out, "무변경인데 다시 읽었다\n" + out
    write(os.path.join(root, "tickets", "bbbbbbbb.md"),
          "---\nticket: bbbbbbbb\ntitle: 인용 대상(수정)\nkind: work\n---\n\n## Goal\n수정됨\n")
    out = build(root)
    assert "changed=1" in out, "파일 하나 수정했는데 changed!=1\n" + out
    g2 = load(root)
    assert {n["type"] for n in g2["nodes"]} == types, "증분 뒤 노드 종류가 줄었다"

    # ---- 5) 파일이 지워지면 인덱스에서도 빠진다 ----
    os.remove(os.path.join(root, "tickets", "bbbbbbbb.md"))
    out = build(root)
    assert "removed=1" in out, "지운 파일이 removed 집계에 안 잡혔다\n" + out
    g3 = load(root)
    assert not any(n["id"] == "bbbbbbbb" and n["type"] == "티켓" for n in g3["nodes"]), \
        "지운 티켓 노드가 안 지워졌다"

    # ---- 6) 검증⑧ - graph.json이 없어도 tick.sh가 WARN-실패 없이 돈다 ----
    os.remove(os.path.join(root, "graph.json"))
    write(os.path.join(root, "personas", "dev", "PROFILE.md"), "# Dev\n")
    w = write(os.path.join(root, "workers", "w.sh"), WORKER.format(name="w", tmp=tmp, tick=TICK))
    os.chmod(w, 0o755)
    local = os.path.join(tmp, "local")
    os.makedirs(local, exist_ok=True)
    r = subprocess.run([w, "dryrun"], capture_output=True, text=True,
                        env=dict(os.environ, TICKET_LOCAL=local), timeout=60)
    assert r.returncode == 0, "graph.json 없을 때 tick.sh dryrun rc={}\n{}{}".format(
        r.returncode, r.stdout, r.stderr)
    runner_log = os.path.join(root, "workers", "runner.log")
    warns = []
    if os.path.exists(runner_log):
        warns = [l for l in open(runner_log, encoding="utf-8") if "WARN" in l]
    assert warns == [], "graph.json 없을 때 WARN이 났다: {}".format(warns)

    print("PASS 노드6종-간선(deps-req-archives-awaiting-인용-위키링크-절참조-근거-구현-links)-"
          "중복제목#N-검증①(표준라이브러리)-검증⑦(큐 무수정)-증분(무변경 0-1장 수정 1-삭제 반영)-"
          "검증⑧(graph.json 없어도 tick.sh 무WARN)")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
