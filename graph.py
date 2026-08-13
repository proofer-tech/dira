#!/usr/bin/env python3
"""마크다운 코퍼스(티켓-스펙-온톨로지-메모리-프로토콜)에 이미 적힌 간선을 읽어
<큐>/graph.json 인덱스를 만든다. graphify(설치본 0.9.41)의 nodes/links 형식이 원형이나
파서는 없다 - 우리 간선은 전부 마크다운에 이미 텍스트로 적혀 있어 정규식으로 충분하다.

호출:
  python3 graph.py build   <큐> [--force]
  python3 graph.py query   <큐> "<질문>" [--dfs] [--budget N]
  python3 graph.py path    <큐> "<A>" "<B>"
  python3 graph.py explain <큐> "<이름>"

  <큐>는 tickets/ personas/ ontology/ protocols/를 담은 루트(예: .dira).
  레포(스펙) 쪽은 <큐>/../docs/DESIGN.md 하나만 읽는다 - 큐의 부모 체크아웃이 master라
  워크트리마다 갈리는 사본이 인덱스에 안 섞인다(DESIGN.md §그래프 탐색 §자리).

  query/path/explain이 내는 것은 답이 아니라 좁혀진 코퍼스다 - 노드 목록 + 간선 + 각 노드의
  원본 경로와 발췌 한 줄. 기본 예산은 6,000 B - 넘으면 시드에서 먼 노드부터 자른다. 시드가
  0개면 빈 결과와 그 사실 한 줄을 낸다(못 찾으면 근처 낱말로 옮겨 타지 않는다).

docs/DESIGN.md §그래프 탐색 (계약).
"""
import collections
import json
import math
import os
import re
import sys
import time
import unicodedata

IN_PROGRESS = os.environ.get("TICKET_INPROGRESS") or ".wip"
DONE = os.environ.get("TICKET_DONE") or ".done"
CLOSED_SUFFIXES = (IN_PROGRESS, DONE)

HASH_RE = r"[0-9a-f]{8}"
CITE_RE = re.compile(r"`(" + HASH_RE + r")`")
WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)")
SECTION_RE = re.compile(r"§([가-힣A-Za-z0-9][가-힣A-Za-z0-9 \-]{0,39})")
FENCE_RE = re.compile(r"^\s*```")
HEADING_RE = re.compile(r"^(#{2,5})\s+(.*)$")


def nfc(s):
    return unicodedata.normalize("NFC", s)


def strip_quotes(s):
    return (s or "").strip().strip("\"'")


# ---------- frontmatter (tickets.py의 read_fm과 같은 모양 -- 그래프는 남의 모듈을
# import하지 않는다(검증 ① - graph.py 자기 import 줄만 표준 라이브러리인지 잰다).
# 온톨로지 frontmatter는 한글 키(이름-구현-근거-값)도 쓰므로 tickets.py보다 키 문자를 넓힌다. ----------

def read_fm(text):
    """(fm dict, 원문줄들, frontmatter 끝 인덱스). frontmatter 없으면 end=-1."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        return {}, lines, -1
    end = -1
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end < 0:
        return {}, lines, -1
    fm = {}
    for i in range(1, end):
        m = re.match(r"^([A-Za-z_가-힣][A-Za-z0-9_가-힣]*):\s*(.*)$", lines[i])
        if m:
            fm[m.group(1)] = m.group(2).strip()
    return fm, lines, end


def block_list(lines, end, key):
    """frontmatter의 `<key>: [a, b]` 인라인 또는 `<key>:\\n  - a\\n  - b` 블록 리스트.
    tickets.py deps_of와 같은 두 문법(deps 두 문법 - CORE §엔진 의미 복제 대상은 아니지만
    같은 파일들이 같은 규약을 쓰므로 읽는 규칙도 맞춘다)."""
    out = []
    for i in range(1, end):
        m = re.match(r"^" + re.escape(key) + r":\s*(.*)$", lines[i])
        if not m:
            continue
        inline = m.group(1).strip().strip("[]")
        if inline:
            out += [strip_quotes(h) for h in inline.split(",")]
        for j in range(i + 1, end):
            m2 = re.match(r"^\s{2,}-\s*(.+?)\s*:?\s*$", lines[j])
            if not m2:
                break
            out.append(strip_quotes(m2.group(1)))
        break
    return [h for h in out if h]


def excerpt_of(s, limit=100):
    s = " ".join((s or "").split())
    return s[:limit]


def first_body_line(lines, end):
    for l in lines[end + 1 if end >= 0 else 0:]:
        l = l.strip().lstrip("#").lstrip("-").strip()
        if l:
            return excerpt_of(l)
    return ""


# ---------- 일반 간선(인용-위키링크-절참조) - 어느 노드 본문에나 적용한다 ----------

def generic_edges(node_id, text, title_index):
    edges = []
    for m in CITE_RE.finditer(text):
        edges.append((node_id, m.group(1), "인용"))
    for m in WIKILINK_RE.finditer(text):
        target = nfc(m.group(1).strip())
        if target:
            edges.append((node_id, target, "위키링크"))
    for m in SECTION_RE.finditer(text):
        target = resolve_section(m.group(1), title_index)
        if target:
            edges.append((node_id, target, "절참조"))
    return edges


def resolve_section(mention, title_index):
    """§멘션 -> DESIGN.md 절 id. 실제 본문은 조사-어미가 제목 뒤에 그대로 붙는다
    (`§그래프 탐색이고` - 공백 없이 `이고`가 붙는다), 그래서 낱말 단위가 아니라 글자
    하나씩 오른쪽에서 잘라가며 짧은 제목 사전에 있는지 본다(dict 조회라 O(멘션 길이)다,
    title_index 전체를 훑지 않는다). ponytail: 전역 첫 일치다 - 같은 짧은 제목이 문서에
    여러 번 나오면(중복 54건 실측) 가장 가까운 절이 아니라 처음 나온 절로 붙는다.
    검증②에 절참조 하한이 없어 여기서 멈춘다 - 질의 티켓(70fbff1c)이 근접도가 필요하다고
    밝히면 그때 절 단위 지역 색인으로 올린다."""
    m = mention.strip()
    while m:
        if m in title_index:
            return title_index[m]
        m = m[:-1]
    return None


# ---------- DESIGN.md - 스펙 절 노드 (노드 하나가 아니라 파일 하나에서 여럿) ----------

def parse_headings(text):
    """(펜스 밖) `##`~`#####` 제목 목록 -> [(level, title, start_line, end_line)]."""
    lines = text.split("\n")
    heads = []
    in_fence = False
    for i, l in enumerate(lines):
        if FENCE_RE.match(l):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        m = HEADING_RE.match(l)
        if m:
            heads.append([len(m.group(1)), m.group(2).strip(), i, len(lines)])
    for i in range(len(heads) - 1):
        heads[i][3] = heads[i + 1][2]
    return heads, lines


def spec_ids(heads):
    """제목 -> id. 중복 제목은 순서대로 #2 #3...을 붙인다(같은 제목 54쌍 실측)."""
    seen = {}
    ids = []
    for _level, title, _s, _e in heads:
        seen[title] = seen.get(title, 0) + 1
        ids.append("DESIGN#" + title if seen[title] == 1 else "DESIGN#{}#{}".format(title, seen[title]))
    return ids


def short_title(title):
    for sep in (" - ", " ("):
        i = title.find(sep)
        if i >= 0:
            return title[:i].strip()
    return title.strip()


def spec_title_index(text):
    """제목 사전만 - 헤딩 목록 훑기 하나뿐이고(펜스 추적 포함) 절 본문의 인용-위키링크-절참조
    정규식 스캔은 안 한다. 이 값은 매 build 호출마다 DESIGN.md 변경 여부와 무관하게
    §절참조 해석에 필요해서(다른 파일의 멘션을 풀려면 있어야 한다), 비싼 generic_edges
    스캔까지 매번 반복하지 않도록 extract_spec에서 떼어냈다(무변경 재빌드 예산 1초를
    지키는 자리 - 안 떼면 4.7MB 본문을 매번 두 번 훑는다)."""
    heads, _lines = parse_headings(text)
    ids = spec_ids(heads)
    title_index = {}
    for (_level, title, _s, _e), sid in zip(heads, ids):
        key = short_title(title)
        if key not in title_index:
            title_index[key] = sid
        if title not in title_index:
            title_index[title] = sid
    return title_index


def extract_spec(path, text, title_index):
    heads, lines = parse_headings(text)
    ids = spec_ids(heads)
    nodes, links = [], []
    for (_level, title, s, e), sid in zip(heads, ids):
        body = "\n".join(lines[s + 1:e])
        nodes.append({"id": sid, "type": "스펙 절", "path": path, "excerpt": excerpt_of(body.split("\n", 1)[0] if body else title)})
        links += [{"source": src, "target": tgt, "rel": rel} for src, tgt, rel in generic_edges(sid, body, title_index)]
    return nodes, links


# ---------- 티켓 ----------

def ticket_stem(basename):
    stem = nfc(basename)
    if stem.endswith(".md"):
        stem = stem[:-3]
    for sfx in CLOSED_SUFFIXES:
        if stem.endswith(nfc(sfx)):
            return stem[: -len(nfc(sfx))]
    return stem


def extract_ticket(path, text, title_index):
    fm, lines, end = read_fm(text)
    tid = strip_quotes(fm.get("ticket")) or ticket_stem(os.path.basename(path))
    tid = nfc(tid)
    node = {"id": tid, "type": "티켓", "path": path, "excerpt": first_body_line(lines, end)}
    links = []
    for h in block_list(lines, end, "deps"):
        links.append({"source": tid, "target": nfc(h), "rel": "deps"})
    for key in ("req", "archives", "awaiting"):
        v = strip_quotes(fm.get(key))
        if v:
            links.append({"source": tid, "target": nfc(v), "rel": key})
    links += [{"source": src, "target": tgt, "rel": rel} for src, tgt, rel in generic_edges(tid, text, title_index)]
    return [node], links


# ---------- 온톨로지 객체 ----------

def extract_ontology(path, text, title_index):
    fm, lines, end = read_fm(text)
    name = nfc(strip_quotes(fm.get("name")) or os.path.splitext(os.path.basename(path))[0])
    node = {"id": name, "type": "온톨로지 객체", "path": path,
            "excerpt": excerpt_of(strip_quotes(fm.get("description")) or first_body_line(lines, end))}
    nodes = [node]
    links = []
    for h in block_list(lines, end, "근거"):
        links.append({"source": name, "target": nfc(h), "rel": "근거"})
    for item in block_list(lines, end, "구현"):
        src_path, _, desc = item.partition(" ")
        src_path = nfc(src_path)
        nodes.append({"id": src_path, "type": "소스 파일", "path": src_path, "excerpt": excerpt_of(desc)})
        links.append({"source": name, "target": src_path, "rel": "구현"})
    for rel, target in ontology_links(lines, end):
        links.append({"source": name, "target": target, "rel": rel})
    links += [{"source": src, "target": tgt, "rel": rel} for src, tgt, rel in generic_edges(name, text, title_index)]
    return nodes, links


def ontology_links(lines, end):
    """`links:\\n  <관계>:\\n    - <표시명>: "[[<대상>]]"` 블록 -> [(관계, 대상), ...].
    관계 이름은 고정 목록이 아니라 파일마다 자유(돌린다-불러온다-검증한다... 실측 5종+).
    """
    out = []
    i = 1
    while i < end and not re.match(r"^links:\s*$", lines[i]):
        i += 1
    i += 1
    while i < end:
        m = re.match(r"^  (\S[^\n:]*):\s*$", lines[i])
        if not m:
            if re.match(r"^\S", lines[i]):
                break
            i += 1
            continue
        rel = m.group(1).strip()
        i += 1
        while i < end and re.match(r"^\s{4,}-\s", lines[i]):
            wm = WIKILINK_RE.search(lines[i])
            if wm:
                out.append((rel, nfc(wm.group(1).strip())))
            i += 1
    return out


# ---------- 메모리 ----------

def extract_memory(path, persona, text, title_index):
    fname = os.path.splitext(os.path.basename(path))[0]
    mid = nfc("{}/{}".format(persona, fname))
    node = {"id": mid, "type": "메모리", "path": path, "excerpt": first_body_line(text.split("\n"), -1)}
    links = [{"source": src, "target": tgt, "rel": rel} for src, tgt, rel in generic_edges(mid, text, title_index)]
    return [node], links


# ---------- 프로토콜 문서 ----------

def extract_protocol(path, text, title_index):
    pid = nfc(os.path.basename(path))
    node = {"id": pid, "type": "프로토콜 문서", "path": path, "excerpt": first_body_line(text.split("\n"), -1)}
    links = [{"source": src, "target": tgt, "rel": rel} for src, tgt, rel in generic_edges(pid, text, title_index)]
    return [node], links


# ---------- 파일 열거 ----------

def list_md(d):
    if not os.path.isdir(d):
        return []
    return sorted(os.path.join(d, f) for f in os.listdir(d)
                  if f.endswith(".md") and not f.startswith("."))


def source_files(troot):
    """(경로, 종류, 부가정보) - 종류는 extract_* 디스패치 키. 없는 디렉터리는 건너뛴다
    (못 5 - 없으면 그냥 없다, 온톨로지 없는 프로젝트와 같은 선)."""
    out = [(p, "ticket", None) for p in list_md(os.path.join(troot, "tickets"))]
    obj_root = os.path.join(troot, "ontology", "objects")
    if os.path.isdir(obj_root):
        for typ in sorted(os.listdir(obj_root)):
            out += [(p, "ontology", None) for p in list_md(os.path.join(obj_root, typ))]
    personas_root = os.path.join(troot, "personas")
    if os.path.isdir(personas_root):
        for persona in sorted(os.listdir(personas_root)):
            out += [(p, "memory", persona) for p in list_md(os.path.join(personas_root, persona, "memory"))]
    out += [(p, "protocol", None) for p in list_md(os.path.join(troot, "protocols"))]
    return out


# ---------- build ----------

def _group_by_src(entries):
    out = {}
    for e in entries:
        out.setdefault(e.get("_src"), []).append(e)
    return out


def build(troot, force=False):
    """증분 - 파일마다 `_src`(원본 경로) 태그를 달아 nodes/links 자체를 캐시 열쇠로 쓴다.
    이전 graph.json 하나만 읽으면 되고(기존 노드/간선을 `_src`로 되묶어 그대로 재사용),
    mtime 따로 + 노드-간선 따로인 `_cache` 사본을 안 둔다 - 파일 크기가 거의 절반이 되고
    (그래프 하나가 아니라 둘을 매번 읽고 쓰던 자리), 무변경 재빌드 예산 1초가 그 절반에서 온다."""
    t0 = time.time()
    graph_path = os.path.join(troot, "graph.json")
    old_mtimes, old_nodes_by_src, old_links_by_src = {}, {}, {}
    if not force and os.path.isfile(graph_path):
        try:
            old = json.load(open(graph_path, encoding="utf-8"))
            old_mtimes = old.get("_mtimes", {})
            old_nodes_by_src = _group_by_src(old.get("nodes", []))
            old_links_by_src = _group_by_src(old.get("links", []))
        except (OSError, ValueError):
            pass

    design_path = os.path.join(troot, "..", "docs", "DESIGN.md")
    title_index = {}
    if os.path.isfile(design_path):
        try:
            title_index = spec_title_index(open(design_path, encoding="utf-8").read())
        except OSError:
            title_index = {}

    new_mtimes = {}
    nodes_by_id, links = {}, []
    changed = reused = 0
    files = source_files(troot)
    if os.path.isfile(design_path):
        files.append((design_path, "spec", None))

    for path, kind, extra in files:
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            continue
        new_mtimes[path] = mtime
        if not force and old_mtimes.get(path) == mtime:
            nodes = old_nodes_by_src.get(path, [])
            file_links = old_links_by_src.get(path, [])
            reused += 1
        else:
            try:
                text = open(path, encoding="utf-8").read()
            except OSError:
                continue
            if kind == "ticket":
                nodes, file_links = extract_ticket(path, text, title_index)
            elif kind == "ontology":
                nodes, file_links = extract_ontology(path, text, title_index)
            elif kind == "memory":
                nodes, file_links = extract_memory(path, extra, text, title_index)
            elif kind == "protocol":
                nodes, file_links = extract_protocol(path, text, title_index)
            else:  # spec
                nodes, file_links = extract_spec(path, text, title_index)
            for e in nodes:
                e["_src"] = path
            for e in file_links:
                e["_src"] = path
            changed += 1
        for n in nodes:
            nodes_by_id.setdefault(n["id"], n)
        links += file_links

    removed = sum(1 for p in old_mtimes if p not in new_mtimes)

    out = {
        "version": 1,
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "nodes": list(nodes_by_id.values()),
        "links": links,
        "_mtimes": new_mtimes,
    }
    tmp = graph_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    os.replace(tmp, graph_path)

    print("OK build nodes={} links={} changed={} reused={} removed={} {:.2f}s".format(
        len(out["nodes"]), len(links), changed, reused, removed, time.time() - t0))


# ---------- 질의 - 시드 매칭 + 예산 순회 (docs/DESIGN.md §그래프 탐색 §질의) ----------

DEFAULT_BUDGET = 6000
# ponytail: 시드 top-K와 순회 깊이는 스펙이 숫자를 안 준다 - 실측 없이 고른 값이다.
# 도달(검증⑤)이 안 되면 여기부터 올린다.
SEED_TOP_K = 8
QUERY_DEPTH = 2
EXPLAIN_DEPTH = 1

TOKEN_RE = re.compile(r"[가-힣A-Za-z0-9]+")


def tokenize(s):
    """1글자 토큰(조사-어미 파편)은 버린다 - 안 버리면 `qt in nt or nt in qt` 부분문자열
    판정이 그 1글자가 아무 질의어에나 걸려 검증⑥(없는 낱말은 빈 결과)이 깨진다."""
    return [t for t in TOKEN_RE.findall((s or "").lower()) if len(t) >= 2]


def load_graph(troot):
    try:
        return json.load(open(os.path.join(troot, "graph.json"), encoding="utf-8"))
    except (OSError, ValueError):
        return None


def design_section_bodies(design_path):
    """DESIGN#<제목> id -> 그 절 본문. build()의 extract_spec과 같은 파싱을 질의 시점에
    다시 돌린다 - 절 본문 전체를 graph.json에 안 실어도(그러면 인덱스가 커진다) 매칭 때만
    디스크에서 읽는다. 디스크 I/O만 쓰고 LLM 토큰은 안 쓰니 이 재파싱은 비용이 0이다."""
    try:
        text = open(design_path, encoding="utf-8").read()
    except OSError:
        return {}
    heads, lines = parse_headings(text)
    ids = spec_ids(heads)
    return {sid: "\n".join(lines[s + 1:e]) for (_level, _title, s, e), sid in zip(heads, ids)}


def protocol_section_excerpt(path, qtokens):
    """프로토콜 문서는 파일 전체가 한 노드라(§노드와 간선 표 - 파일명) 발췌가 늘 문서 첫 줄로
    고정돼 있었다 - AGENTS.md처럼 여러 절을 담은 파일에서는 시드로 잡혀도 어느 절이 맞는지
    안 보였다(실측 - Q1 '한도를 만났을 때'). 노드는 안 쪼개고, 질의 토큰과 가장 많이 겹치는
    절만 찾아 그 절의 첫 줄로 발췌를 바꿔치기한다."""
    try:
        text = open(path, encoding="utf-8").read()
    except OSError:
        return None
    heads, lines = parse_headings(text)
    best, best_hits = None, 0
    for _level, title, s, e in heads:
        body = "\n".join(lines[s + 1:e])
        hits = len(set(tokenize(title + " " + body)) & qtokens)
        if hits > best_hits:
            best_hits, best = hits, (title, body)
    if best is None:
        return None
    title, body = best
    first = next((l.strip() for l in body.split("\n") if l.strip()), title)
    return excerpt_of(short_title(title) + " - " + first)


def with_protocol_excerpts(nodes_by_id, ids, query_text):
    """render 직전에 한 번 - 후보 노드 중 프로토콜 문서만 발췌를 질의에 맞게 바꾼다.
    graph.json은 그대로 두고(빌드 결과 불변), 조회 시점에만 사본에 덮어쓴다."""
    qtokens = set(tokenize(query_text))
    if not qtokens:
        return nodes_by_id
    out = dict(nodes_by_id)
    for nid in ids:
        node = out.get(nid)
        if node and node.get("type") == "프로토콜 문서":
            alt = protocol_section_excerpt(node["path"], qtokens)
            if alt:
                out[nid] = dict(node, excerpt=alt)
    return out


def node_search_texts(nodes, troot):
    """노드 id -> 매칭용 원문. 발췌 한 줄이 아니라 파일 전체를 읽는다 - §한도처럼 파일
    중간에 있는 절도 찾아야 한다. 같은 경로(티켓-온톨로지-메모리-프로토콜 파일, DESIGN.md)는
    한 번만 읽는다."""
    design_path = os.path.join(troot, "..", "docs", "DESIGN.md")
    design_bodies = None
    file_cache = {}
    out = {}
    for n in nodes:
        nid, typ = n["id"], n["type"]
        if typ == "스펙 절":
            if design_bodies is None:
                design_bodies = design_section_bodies(design_path)
            out[nid] = nid + " " + design_bodies.get(nid, n.get("excerpt", ""))
        elif typ == "소스 파일":
            out[nid] = nid + " " + n.get("excerpt", "")
        else:
            path = n.get("path")
            text = file_cache.get(path)
            if text is None:
                try:
                    text = open(path, encoding="utf-8").read()
                except OSError:
                    text = n.get("excerpt", "")
                file_cache[path] = text
            out[nid] = nid + " " + text
    return out


def build_idf(node_token_sets):
    df = {}
    for toks in node_token_sets.values():
        for t in toks:
            df[t] = df.get(t, 0) + 1
    n = len(node_token_sets)
    return {t: math.log((n + 1) / (c + 1)) + 1.0 for t, c in df.items()}


def build_adj(links):
    adj = {}
    for e in links:
        adj.setdefault(e["source"], set()).add(e["target"])
        adj.setdefault(e["target"], set()).add(e["source"])
    return {k: sorted(v) for k, v in adj.items()}


def build_degree(links):
    deg = {}
    for e in links:
        deg[e["source"]] = deg.get(e["source"], 0) + 1
        deg[e["target"]] = deg.get(e["target"], 0) + 1
    return deg


MAX_SUFFIX_LEN = 2
# ponytail: 조사-어미로 보아 줄 길이차 상한이다. 실측(2026-08-13, .dira 4천 노드)에서 방향
# 안 가린 substring까지 열었더니 "트리케라톱스"가 흔한 낱말 "트리"(나무-트리구조)에, "타로카드"가
# "카드"에, "히말라야"가 "말라"에 걸려 없는 낱말인데 시드가 잡혔다(검증⑥ 회귀). 한국어 조사-어미는
# 어근 뒤에만 붙으므로 prefix(어근이 앞) 방향만 남기고 substring(어근이 중간-끝)은 없앤다 - 그만큼
# "토큰소진"처럼 어근이 낱말 뒤쪽에 오는 복합어는 못 찾는다. 오매칭이 남으면 길이차를 더 줄인다.


def token_tier(qt, node_token_set):
    """질의 낱말 하나 대 노드 낱말 집합 - 3 exact / 2 prefix(길이차 <= MAX_SUFFIX_LEN) / 0 없음."""
    if qt in node_token_set:
        return 3
    for nt in node_token_set:
        long_, short_ = (nt, qt) if len(nt) >= len(qt) else (qt, nt)
        if len(long_) - len(short_) <= MAX_SUFFIX_LEN and long_.startswith(short_):
            return 2
    return 0


def score_nodes(query_text, node_ids, node_token_sets, idf, degree):
    """(점수, node_id) 내림차순 - 동점은 degree 내림차순, id 오름차순. 겹치는 낱말이 하나도
    없는 노드는 아예 안 낀다(없으면 지어내지 않는다 - 못 4)."""
    qtokens = list(dict.fromkeys(tokenize(query_text)))
    if not qtokens:
        return []
    scored = []
    for nid in node_ids:
        toks = node_token_sets[nid]
        weight, matched = 0.0, 0
        for qt in qtokens:
            tier = token_tier(qt, toks)
            if tier:
                weight += tier * idf.get(qt, 1.0)
                matched += 1
        if matched:
            coverage = matched / len(qtokens)
            scored.append((weight * coverage * coverage, nid))
    scored.sort(key=lambda x: (-x[0], -degree.get(x[1], 0), x[1]))
    return scored


def traverse(seed_ids, adj, depth_limit, dfs=False):
    """시드에서 depth_limit 홉까지 - dist[id] = 시드까지 거리. BFS는 최단거리, DFS는 그
    갈래를 따라간 거리다(예산 절단은 둘 다 depth_limit로 잘리므로 이 근사로 충분하다)."""
    dist = {s: 0 for s in seed_ids}
    if dfs:
        stack = list(reversed(seed_ids))
        while stack:
            u = stack.pop()
            if dist[u] >= depth_limit:
                continue
            for v in adj.get(u, ()):
                if v not in dist:
                    dist[v] = dist[u] + 1
                    stack.append(v)
    else:
        q = collections.deque(seed_ids)
        while q:
            u = q.popleft()
            if dist[u] >= depth_limit:
                continue
            for v in adj.get(u, ()):
                if v not in dist:
                    dist[v] = dist[u] + 1
                    q.append(v)
    return dist


def format_node_line(node, dist=None):
    head = "[{}] {}".format(node["id"], node["type"])
    if dist is not None:
        head += " (거리 {})".format(dist)
    return "{} 경로: {}\n  발췌: {}\n".format(head, node.get("path", ""), node.get("excerpt", ""))


def format_edge_line(e):
    return "{} -{}-> {}\n".format(e["source"], e["rel"], e["target"])


def render_budget(header, ordered_ids, nodes_by_id, links, seed_score, budget):
    """거리 순(동점은 ordered_ids가 이미 정한 순서) 노드를 예산 안에서 채운다. 노드를 하나
    더할 때마다 이미 포함된 노드로 이어진 간선도 같이 셈해 - 넘치면 그 노드부터(그리고 남은,
    더 먼 노드 전부를) 자른다(§검증④ - 시드에서 먼 노드부터 자른다)."""
    included, included_set = [], set()
    edge_seen = set()
    text = header
    for nid, dist in ordered_ids:
        node = nodes_by_id.get(nid)
        if node is None:
            continue
        new_edges = [e for e in links if (e["source"], e["target"], e["rel"]) not in edge_seen
                     and ((e["source"] == nid and e["target"] in included_set)
                          or (e["target"] == nid and e["source"] in included_set))]
        add = format_node_line(node, dist) + "".join(format_edge_line(e) for e in new_edges)
        candidate = text + add
        if len(candidate.encode("utf-8")) > budget:
            break
        text = candidate
        included.append(nid)
        included_set.add(nid)
        edge_seen.update((e["source"], e["target"], e["rel"]) for e in new_edges)
    return text, included


def _prep(troot):
    g = load_graph(troot)
    if g is None:
        return None
    nodes, links = g["nodes"], g["links"]
    nodes_by_id = {n["id"]: n for n in nodes}
    node_ids = list(nodes_by_id)
    search_texts = node_search_texts(nodes, troot)
    node_token_sets = {nid: set(tokenize(search_texts[nid])) for nid in node_ids}
    idf = build_idf(node_token_sets)
    degree = build_degree(links)
    return nodes_by_id, node_ids, node_token_sets, idf, degree, links


NO_INDEX = "그래프 인덱스 없음 - 먼저 'python3 graph.py build <큐>'\n"


def query(troot, question, dfs=False, budget=DEFAULT_BUDGET):
    header = "질의: {}\n".format(question)
    prep = _prep(troot)
    if prep is None:
        return header + NO_INDEX
    nodes_by_id, node_ids, node_token_sets, idf, degree, links = prep
    scored = score_nodes(question, node_ids, node_token_sets, idf, degree)
    if not scored:
        return header + "시드 없음 - 코퍼스에 이 질문과 겹치는 낱말이 없다\n"
    top = scored[:SEED_TOP_K]
    seeds = [nid for _s, nid in top]
    relevance = {nid: s for s, nid in scored}
    adj = build_adj(links)
    dist = traverse(seeds, adj, QUERY_DEPTH, dfs=dfs)
    # 같은 거리 층 안에서는 질의와의 관련도(전체 코퍼스 채점, 시드 것만이 아니다)로 다시 세운다 -
    # 안 그러면 텍스트와 무관한, 그냥 자주 인용된 이웃이 예산을 먼저 먹어 2홉 거리의 진짜
    # 관련 문서를 밀어낸다(실측 - AGENTS.md가 관련도 6위인데 2홉이라 5000B 예산에서 잘렸다).
    # 거리가 먼저이므로 "시드에서 먼 노드부터 자른다"(검증④)는 그대로다.
    ordered = sorted(dist.items(), key=lambda kv: (kv[1], -relevance.get(kv[0], 0), kv[0]))
    sub_ids = set(dist)
    sub_links = [e for e in links if e["source"] in sub_ids and e["target"] in sub_ids]
    header += "시드: {}\n".format(", ".join(seeds))
    nodes_by_id = with_protocol_excerpts(nodes_by_id, sub_ids, question)
    text, _included = render_budget(header, ordered, nodes_by_id, sub_links, relevance, budget)
    return text


def path(troot, a, b):
    prep = _prep(troot)
    if prep is None:
        return NO_INDEX
    nodes_by_id, node_ids, node_token_sets, idf, degree, links = prep

    def resolve(q):
        scored = score_nodes(q, node_ids, node_token_sets, idf, degree)
        return scored[0][1] if scored else None

    ida, idb = resolve(a), resolve(b)
    if ida is None or idb is None:
        return "시드 없음: '{}' - 코퍼스에 없다\n".format(a if ida is None else b)

    adj = build_adj(links)
    prev = {ida: None}
    q = collections.deque([ida])
    while q:
        u = q.popleft()
        if u == idb:
            break
        for v in adj.get(u, ()):
            if v not in prev:
                prev[v] = u
                q.append(v)
    if idb not in prev:
        return "경로 없음: {} <-> {} (연결 안 됨)\n".format(ida, idb)

    chain = []
    cur = idb
    while cur is not None:
        chain.append(cur)
        cur = prev[cur]
    chain.reverse()

    def edge_label(u, v):
        for e in links:
            if e["source"] == u and e["target"] == v:
                return "-{}->".format(e["rel"])
        for e in links:
            if e["source"] == v and e["target"] == u:
                return "<-{}-".format(e["rel"])
        return "--"

    parts = [chain[0]]
    for u, v in zip(chain, chain[1:]):
        parts.append(edge_label(u, v))
        parts.append(v)
    out = "질의: '{}' -> '{}'\n시드: {} -> {}\n경로({}홉): {}\n".format(
        a, b, ida, idb, len(chain) - 1, " ".join(parts))
    for nid in chain:
        out += format_node_line(nodes_by_id[nid])
    return out


def explain(troot, name):
    header = "설명: {}\n".format(name)
    prep = _prep(troot)
    if prep is None:
        return header + NO_INDEX
    nodes_by_id, node_ids, node_token_sets, idf, degree, links = prep
    scored = score_nodes(name, node_ids, node_token_sets, idf, degree)
    if not scored:
        return header + "시드 없음 - 코퍼스에 이 이름과 겹치는 낱말이 없다\n"
    seed = scored[0][1]
    adj = build_adj(links)
    dist = traverse([seed], adj, EXPLAIN_DEPTH)
    ordered = sorted(dist.items(), key=lambda kv: (kv[1], kv[0]))
    sub_ids = set(dist)
    sub_links = [e for e in links if e["source"] in sub_ids and e["target"] in sub_ids]
    header += "시드: {}\n".format(seed)
    nodes_by_id = with_protocol_excerpts(nodes_by_id, sub_ids, name)
    text, _included = render_budget(header, ordered, nodes_by_id, sub_links, {}, DEFAULT_BUDGET)
    return text


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    cmd = sys.argv[1]
    if cmd == "build":
        if len(sys.argv) < 3:
            raise SystemExit(__doc__)
        build(sys.argv[2], force="--force" in sys.argv[3:])
    elif cmd == "query":
        if len(sys.argv) < 4:
            raise SystemExit(__doc__)
        rest = sys.argv[4:]
        budget = int(rest[rest.index("--budget") + 1]) if "--budget" in rest else DEFAULT_BUDGET
        print(query(sys.argv[2], sys.argv[3], dfs="--dfs" in rest, budget=budget), end="")
    elif cmd == "path":
        if len(sys.argv) < 5:
            raise SystemExit(__doc__)
        print(path(sys.argv[2], sys.argv[3], sys.argv[4]), end="")
    elif cmd == "explain":
        if len(sys.argv) < 4:
            raise SystemExit(__doc__)
        print(explain(sys.argv[2], sys.argv[3]), end="")
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main()
