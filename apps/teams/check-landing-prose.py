#!/usr/bin/env python3
"""랜딩의 한글 산문이 통째로 보존됐는지 본다. 태그·클래스·줄바꿈·절 순서는 안 본다.
    python3 apps/teams/check-landing-prose.py [<비교대상 git ref>]
단위는 텍스트 노드 하나다 — 산문이 재배치돼도 통과하고, 한 조각이라도 지워지면 잡는다.

**표본을 `51b7bba`(Vue 83노드)에서 `aa36aba`(TSX)로 옮겼다** — 요구 `b4155b01`이 랜딩 카피를
im-korean으로 윤문하라고 했고, 윤문은 뜻을 보존하되 문자열을 갈아 옛 83노드 대부분이 MISSING으로
떴다. 검사를 느슨하게 고치는 대신 표본을 이번 회차가 확정한 카피로 옮긴 것이다(§P259 · `34a441ce`).
이 도구가 지키는 성질은 <특정 문장>이 아니라 <사람이 확정한 카피가 다음 개편에서 조용히
지워지지 않는다>이고, 그 성질은 표본을 옮겨도 그대로 산다. 양쪽이 다 TSX라 보간·주석 문법을
두 벌로 읽던 자리는 그냥 남겨 둔다 — 판정 자체는 종전 그대로다.

알려진 오탐 하나: 문장 **중간**에 태그를 끼우면(`터미널을` → `<em>터미널</em>을`) 그 노드가
갈려서 사라진 것으로 잡힌다. 그때는 MISSING으로 찍힌 조각이 화면에 온전히 남아 있는지 눈으로
확인하고 `## 결과`에 그 사실을 적는다 — 검사를 느슨하게 고치지 않는다."""
import re, subprocess, sys

OLD = "apps/teams/app/(site)/landing.tsx"             # 비교대상 ref에서 읽는다 — 표본이 사는 자리
NEW = "apps/teams/app/(site)/landing.tsx"             # 지금 트리에서 읽는다 — 이사한 새 자리(6a24257d)

# 윤문(`34a441ce`)이 확정한 카피를 담은 커밋이다. master의 조상이라 앞으로도 유효하다 —
# 기본값이 `master`면 표본이 트리를 따라 흘러 이 검사가 아무것도 안 지킨다. 카피를 사람이
# 다시 확정하는 회차가 오면 그때 이 해시를 그 커밋으로 옮긴다. 다른 ref는 인자로 준다.
DEFAULT_REF = "aa36aba"

# 사람이 카피를 직접 바꾸며 지운 노드 — `old`가 아니라 `missing`에서만 거른다(§old에서 거르면
# 노드 수가 82로 줄어 스펙의 `83노드` 인용이 낡는다). 출처: .dira/tickets/be8f8074.done.md
#
# 옛 마지막 CTA 절이 플랜 절에 합쳐지며 지운 노드 둘 — developer는 사용자가 읽는 산문을
# 새로 안 쓴다(넛지 문장은 후속 writer 티켓 `1466dd10`이 쓴다), 레포 링크는 같은 절 Free
# 카드의 `Star`와 목적지가 이미 같아서 안 옮겼다. 출처: .dira/tickets/79011562.wip.md
REMOVED_NODES = {
    "쓸 수 있는 것은 전부 무료입니다",
    "dira와 함께 PC에 나만의 멀티 에이전트 시스템을 아주 쉽게 만들어보세요.",
    "GitHub에서 보기",
}


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
