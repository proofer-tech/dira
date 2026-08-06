#!/usr/bin/env python3
"""랜딩의 한글 산문이 통째로 보존됐는지 본다. 태그·클래스·줄바꿈·절 순서는 안 본다.
    python3 apps/site/check-landing-prose.py [<비교대상 git ref>]
단위는 텍스트 노드 하나다 — 산문이 재배치돼도 통과하고, 한 조각이라도 지워지면 잡는다.

랜딩이 `Landing.vue`(vitepress)에서 `app/landing.tsx`(Next)로 옮겨 갔다(§사이트 기반 §순서 ⑥).
그래서 **비교대상 ref는 Vue를, 지금 트리는 TSX를 읽는다.** 갈린 것은 셋이다 —
마크업이 시작하는 자리(`<template>` / `return (`) · 주석 문법(`<!-- -->` / `{/* */}`) ·
보간 문법(`{{ x }}` / `{x}`, 둘 다 `{}`로 접어 대조한다). 판정 자체는 종전 그대로다.

알려진 오탐 하나: 문장 **중간**에 태그를 끼우면(`터미널을` → `<em>터미널</em>을`) 그 노드가
갈려서 사라진 것으로 잡힌다. 그때는 MISSING으로 찍힌 조각이 화면에 온전히 남아 있는지 눈으로
확인하고 `## 결과`에 그 사실을 적는다 — 검사를 느슨하게 고치지 않는다."""
import re, subprocess, sys

OLD = "apps/site/.vitepress/theme/Landing.vue"   # 비교대상 ref에서 읽는다
NEW = "apps/site/app/landing.tsx"                # 지금 트리에서 읽는다

# `OLD`는 §순서 ⑧(`1ff5f751`)이 `.vitepress/`를 지운 뒤로 **history에만 산다.** 그래서 기본값이
# `master`면 이 도구가 자기 대조 표본을 못 찾아 죽는다 — 이 해시가 그 삭제 직전 커밋이고,
# master의 조상이라 앞으로도 유효하다. 다른 ref를 대려면 인자로 준다.
DEFAULT_REF = "51b7bba"

# 사람이 카피를 직접 바꾸며 지운 노드 — `old`가 아니라 `missing`에서만 거른다(§old에서 거르면
# 노드 수가 82로 줄어 스펙의 `83노드` 인용이 낡는다). 출처: .dira/tickets/be8f8074.done.md
REMOVED_NODES = {"쓸 수 있는 것은 전부 무료입니다"}


def nodes(src):
    # 마크업이 시작하는 자리부터 본다 — 그 앞의 스크립트에는 한글 주석이 산다
    body = src[re.search(r"<template>|return \(", src).end():]
    body = re.sub(r"<!--.*?-->|\{/\*.*?\*/\}", "\n", body, flags=re.S)
    body = re.sub(r"<[^>]*>", "\n", body)             # 태그 하나가 경계다
    out = []
    for chunk in body.split("\n"):
        chunk = " ".join(chunk.split())                # 노드 안의 줄바꿈만 정규화
        chunk = re.sub(r"\{\{\s*\w+\s*\}\}|\{\w+\}", "{}", chunk)   # 보간 두 문법
        if len(re.findall(r"[가-힣]", chunk)) >= 4:     # 한글 4자 이상 = 산문
            out.append(chunk)
    return out


ref = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_REF
src = subprocess.run(["git", "show", f"{ref}:{OLD}"], capture_output=True, text=True).stdout
if not src:
    sys.exit(f"{ref}:{OLD} 를 못 읽었다 — 이식 전 ref를 인자로 준다 (기본 {DEFAULT_REF})")
old = nodes(src)
new = nodes(open(NEW).read())
joined = " | ".join(new)
missing = [s for s in old if s not in joined and s not in REMOVED_NODES]
print(f"{ref} 산문 노드 {len(old)}개 / 사라진 것 {len(missing)}개 (지금 {len(new)}개)")
for m in missing:
    print("  MISSING:", m[:78])
sys.exit(1 if missing else 0)
