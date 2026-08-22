#!/usr/bin/env python3
"""graph.py build 자체검증: 노드 6종-간선(deps/req/archives/awaiting/인용/위키링크/절참조/
근거/구현/links:) 이 §그래프 탐색 §노드와 간선 표대로 서는가, 증분 빌드가 안 바뀐 파일을
다시 안 읽는가, 큐(티켓 frontmatter)를 안 건드리는가, 인덱스가 없어도 tick.sh가 WARN 없이
도는가(검증 ⑧). 뒤쪽은 query/path/explain의 시드 매칭(exact/prefix/substring 우선순위 -
무관어 배제 - 빈 낱말 빈 결과)과 예산 절단(안 넘김 - 먼 노드부터 자름)을 함수 단위로 잰다.
실패하면 assert로 죽는다.

docs/DESIGN.md §그래프 탐색 §검증.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
GRAPH = os.path.join(HERE, "graph.py")
TICK = os.path.join(HERE, "tick.sh")
sys.path.insert(0, HERE)
import graph  # noqa: E402

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


def build(root, force=False, ontology=None):
    args = ["python3", GRAPH, "build", root] + (["--force"] if force else [])
    env = dict(os.environ)
    if ontology is not None:
        env["TICKET_ONTOLOGY"] = ontology
    else:
        env.pop("TICKET_ONTOLOGY", None)
    r = subprocess.run(args, capture_output=True, text=True, env=env, timeout=60)
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

    # ---- 7) 시드 매칭 - exact > prefix > substring, 무관 노드는 안 낀다, 빈 낱말은 빈 결과 ----
    qroot = os.path.join(tmp, "qdira")
    write(os.path.join(qroot, "tickets", "11111111.md"),
          "---\nticket: 11111111\ntitle: 소진 처리\nkind: work\n---\n\n"
          "## Goal\n토큰이 소진되면 unassign한다. [[대상개념]]을 참고.\n")
    write(os.path.join(qroot, "tickets", "22222222.md"),
          "---\nticket: 22222222\ntitle: 무관\nkind: work\n---\n\n## Goal\n전혀 다른 내용.\n")
    write(os.path.join(qroot, "ontology", "objects", "기능", "대상개념.md"),
          "---\ntype: 기능\nname: 대상개념\n---\n\n# 대상개념\n소진과 무관한 개념 설명.\n")
    write(os.path.join(qroot, "..", "docs", "DESIGN.md"),
          "# 스펙\n\n## 한도\n소진되면 세션이 unassign한다.\n")
    build(qroot, force=True)
    qg = load(qroot)
    qnodes, qlinks = qg["nodes"], qg["links"]
    search = graph.node_search_texts(qnodes, qroot)
    token_sets = {n["id"]: set(graph.tokenize(search[n["id"]])) for n in qnodes}
    ids = [n["id"] for n in qnodes]
    idf = graph.build_idf(token_sets)
    degree = graph.build_degree(qlinks)

    scored = graph.score_nodes("토큰이 소진되면 세션은 무엇을 하나", ids, token_sets, idf, degree)
    assert scored, "시드 매칭 실패 - 빈 결과"
    top_ids = [nid for _s, nid in scored]
    assert top_ids[0] == "11111111", "가장 관련 있는 노드가 1위가 아니다: {}".format(top_ids[:3])
    assert "22222222" not in top_ids, "겹치는 낱말이 0개인 노드가 시드에 낀다: {}".format(top_ids)

    no_match = graph.score_nodes("쿠버네티스 헬름 차트", ids, token_sets, idf, degree)
    assert no_match == [], "코퍼스에 없는 낱말인데 시드가 잡혔다: {}".format(no_match)

    # ---- 8) 예산 절단 - render_budget이 예산을 절대 안 넘고, 좁은 예산에서 먼 노드부터 빠진다 ----
    nodes_by_id = {n["id"]: n for n in qnodes}
    adj = graph.build_adj(qlinks)
    seed_id = "11111111"
    dist = graph.traverse([seed_id], adj, 2)
    ordered = sorted(dist.items(), key=lambda kv: (kv[1], kv[0]))
    assert len(ordered) > 1, "픽스처가 1홉도 안 이어져 있다 - 절단 판정을 못 세운다: {}".format(ordered)
    sub_ids = set(dist)
    sub_links = [e for e in qlinks if e["source"] in sub_ids and e["target"] in sub_ids]

    wide_text, wide_included = graph.render_budget("헤더\n", ordered, nodes_by_id, sub_links, {}, 6000)
    assert len(wide_text.encode("utf-8")) <= 6000, "기본 예산 6000B를 넘었다"
    assert seed_id in wide_included

    farthest = ordered[-1][0]
    tiny_budget = len(("헤더\n" + graph.format_node_line(nodes_by_id[seed_id], 0)).encode("utf-8"))
    tiny_text, tiny_included = graph.render_budget("헤더\n", ordered, nodes_by_id, sub_links, {}, tiny_budget)
    assert len(tiny_text.encode("utf-8")) <= tiny_budget, "좁은 예산을 넘었다"
    assert seed_id in tiny_included, "시드 자신도 못 들어갔다"
    assert farthest not in tiny_included, "좁은 예산에서 먼 노드가 안 잘렸다: {}".format(tiny_included)
    assert len(tiny_included) < len(wide_included), "좁은 예산이 넓은 예산과 같은 수를 담았다"

    # ---- 9) query/path/explain CLI가 §질의의 사용법 그대로 돈다 ----
    r = subprocess.run(["python3", GRAPH, "query", qroot, "토큰이 소진되면 세션은 무엇을 하나"],
                        capture_output=True, text=True, timeout=30)
    assert r.returncode == 0 and "11111111" in r.stdout, "query CLI 실패\n" + r.stdout + r.stderr
    assert len(r.stdout.encode("utf-8")) <= 6000, "query 기본 산출이 예산을 넘었다"

    r = subprocess.run(["python3", GRAPH, "query", qroot, "쿠버네티스 헬름 차트"],
                        capture_output=True, text=True, timeout=30)
    assert r.returncode == 0 and "시드 없음" in r.stdout, "없는 낱말인데 시드 없음이 안 찍혔다\n" + r.stdout

    r = subprocess.run(["python3", GRAPH, "explain", qroot, "대상개념"],
                        capture_output=True, text=True, timeout=30)
    assert r.returncode == 0 and "대상개념" in r.stdout, "explain CLI 실패\n" + r.stdout + r.stderr

    r = subprocess.run(["python3", GRAPH, "path", qroot, "소진 처리", "대상개념"],
                        capture_output=True, text=True, timeout=30)
    assert r.returncode == 0 and "11111111" in r.stdout and "대상개념" in r.stdout, \
        "path CLI 실패\n" + r.stdout + r.stderr

    # ---- 10) 회귀(3332cdb9 Q3) - 프로토콜 문서는 파일 전체가 한 노드라 발췌가 늘 문서
    # 첫 줄로 고정돼 있었다. 여러 절을 담은 프로토콜 문서에서도 질의와 맞는 절의 발췌로
    # 바뀌는지 확인한다(with_protocol_excerpts) ----
    eroot = os.path.join(tmp, "eroot")
    write(os.path.join(eroot, "protocols", "AGENTS.md"),
          "# 프로토콜\n\n## 다른 절\n관련 없는 내용.\n\n"
          "## 완료 트리거\n티켓을 끝낼 때 아카이브 티켓 frontmatter에 deps: 와 archives: 를 "
          "반드시 채운다.\n")
    build(eroot, force=True)
    q3 = ("완료한 티켓을 archive-manager에게 넘길 때 아카이브 티켓 frontmatter에 "
          "반드시 들어가는 키 둘은?")
    r = subprocess.run(["python3", GRAPH, "query", eroot, q3],
                        capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, "query CLI 실패\n" + r.stdout + r.stderr
    assert "완료 트리거" in r.stdout, \
        "AGENTS.md가 시드에 잡혀도 발췌가 문서 첫 줄에 고정돼 있다\n" + r.stdout

    # ---- 11) 회귀(3332cdb9 Q1) - 채점식의 근본 한계: 질의를 그대로 인용/논의하는 문서가
    # 다르게 표현된(paraphrase) 정답 문서보다 늘 이긴다 - 어휘 일치만 보고 "정답"과 "질문을
    # 논하는 글"을 못 가른다. 상수(SEED_TOP_K, 예산)를 만지면 검증②(프롬프트 예산 불변)를
    # 깨므로 이 티켓 범위에서는 못 고친다 - 4a14fbea에 kind:feedback으로 넘긴 근거를 여기
    # 고정한다. 채점식을 재설계해 이 assert가 깨지면 823f7d56 판정도 같이 갱신할 것 ----
    lroot = os.path.join(tmp, "lroot")
    q1 = "토큰이 소진되면 세션은 무엇을 해야 하나"
    write(os.path.join(lroot, "protocols", "AGENTS.md"),
          "# 프로토콜\n\n## 한도를 만났을 때\n토큰이 다 떨어지면 session-rotate 뒤 접는다.\n")
    write(os.path.join(lroot, "tickets", "qqqqqqqq.md"),
          "---\nticket: qqqqqqqq\ntitle: 질문 기록\nkind: work\n---\n\n## Goal\n{}\n".format(q1))
    build(lroot, force=True)
    lg = load(lroot)
    lsearch = graph.node_search_texts(lg["nodes"], lroot)
    ltoken_sets = {n["id"]: set(graph.tokenize(lsearch[n["id"]])) for n in lg["nodes"]}
    lids = [n["id"] for n in lg["nodes"]]
    lidf = graph.build_idf(ltoken_sets)
    ldegree = graph.build_degree(lg["links"])
    lscored = {nid: s for s, nid in graph.score_nodes(q1, lids, ltoken_sets, lidf, ldegree)}
    assert lscored["qqqqqqqq"] > lscored["AGENTS.md"], \
        "회귀: 질의를 그대로 인용한 문서가 더는 정답 문서를 안 이긴다 - 고쳐졌으면 이 assert를 " \
        "고치고 4a14fbea kind:feedback 판정도 갱신할 것: {}".format(lscored)

    # ---- 12) TICKET_ONTOLOGY 재정의 - graph.py도 <온톨로지>/objects/<타입>/을 그 자리에서 본다
    # (85114387). 큐 안 ontology/objects는 비워둬 재정의가 실제로 먹혔는지 가른다 ----
    oroot = os.path.join(tmp, "oroot")
    extont = os.path.join(tmp, "밖온톨로지")
    write(os.path.join(oroot, "tickets", "cccccccc.md"),
          "---\nticket: cccccccc\ntitle: 재정의\nkind: work\n---\n\n## Goal\n무관\n")
    write(os.path.join(extont, "objects", "기능", "밖개념.md"),
          "---\ntype: 기능\nname: 밖개념\n---\n\n# 밖개념\n큐 밖 온톨로지 객체\n")
    build(oroot, force=True, ontology=extont)
    og = load(oroot)
    assert any(n["id"] == "밖개념" and n["type"] == "온톨로지 객체" for n in og["nodes"]), \
        "TICKET_ONTOLOGY 자리의 objects/가 인덱스에 안 들었다: {}".format(og["nodes"])

    # 재정의 없이 같은 큐를 다시 빌드하면 큐 안 ontology/objects(없음)로 돌아간다 - 밖개념은 빠진다
    build(oroot, force=True)
    og2 = load(oroot)
    assert not any(n["id"] == "밖개념" for n in og2["nodes"]), \
        "TICKET_ONTOLOGY 없이도 밖 온톨로지 객체가 남았다: {}".format(og2["nodes"])

    print("PASS 노드6종-간선(deps-req-archives-awaiting-인용-위키링크-절참조-근거-구현-links)-"
          "중복제목#N-검증①(표준라이브러리)-검증⑦(큐 무수정)-증분(무변경 0-1장 수정 1-삭제 반영)-"
          "검증⑧(graph.json 없어도 tick.sh 무WARN)-시드매칭(exact우선-무관어배제-빈결과)-"
          "예산절단(안넘김-먼노드부터자름)-query/path/explain CLI-"
          "3332cdb9 회귀(Q3 프로토콜 절 발췌 고침-Q1 채점식 근본한계 문서화)-"
          "TICKET_ONTOLOGY 재정의(objects/ 자리 이동-미설정시 기본값 복귀)")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
