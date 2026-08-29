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
확인하고 `## 결과`에 그 사실을 적는다 — 검사를 느슨하게 고치지 않는다.

**넓힌 자리(티켓 `76b659fd`, P340-3)** — 문구가 `lib/i18n.ts`의 `ko` 사전으로 옮겨 가면서
`landing.tsx` 텍스트 노드가 `t()`/`useT()` 호출로 바뀌어 이 도구가 못 읽는 자리가 됐다. `new`를
`landing.tsx` + `lib/i18n.ts`의 `ko` 사전 값 둘로 넓힌다 — `en`은 안 본다(이 티켓이 안 채우는
사전이라 훑어도 항상 비어 있다). `ko` 값을 읽는 자리는 정규식이 아니라 `node`로 그 모듈을 직접
불러 얻는다 — 사전 값에 큰따옴표·작은따옴표가 섞여 있어 정규식 파싱이 갈리기 쉽다(이미 설치된
런타임을 쓰는 것이 새 의존성보다 싸다)."""
import json, os, re, subprocess, sys

TEAMS_DIR = os.path.dirname(os.path.abspath(__file__))

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
#
# `4af7709f`(금지어 `선다`류 일괄 치환, 664자리)가 이 노드 하나의 실제 화면 문구까지 건드렸다
# (`한 줄이 서고` → `한 줄이 뜨고`) — 지운 것이 아니라 고쳐 쓴 것이라 뜻은 그대로다. 표본을
# 그 커밋으로 옮기지 않고 이 노드만 예외로 둔다(§DEFAULT_REF 규칙 — 사람이 카피를 다시 확정한
# 회차가 아니라서다). 출처: 티켓 `76b659fd`.
REMOVED_NODES = {
    "쓸 수 있는 것은 전부 무료입니다",
    "dira와 함께 PC에 나만의 멀티 에이전트 시스템을 아주 쉽게 만들어보세요.",
    "GitHub에서 보기",
    "한 줄이 서고 이것도 워커가 받아서 하는 일이라 어디까지",
}


def prose_of(chunks):
    out = []
    for chunk in chunks:
        chunk = " ".join(chunk.split())                # 노드 안의 줄바꿈만 정규화
        chunk = re.sub(r"\{\{\s*\w+\s*\}\}|\{\w+\}", "{}", chunk)   # 보간 두 문법
        if len(re.findall(r"[가-힣]", chunk)) >= 4:     # 한글 4자 이상 = 산문
            out.append(chunk)
    return out


def nodes(src):
    # 마크업이 시작하는 자리부터 본다 — 그 앞의 스크립트에는 한글 주석이 산다. `return \(`
    # 뒤에 줄바꿈을 요구한다 — 아니면 `return () => ...` 화살함수도 걸려서 그 앞 `useEffect`
    # 주석까지 스캔에 들어온다(실측 `76b659fd` — 이 버그로 코드 주석 셋이 오탐 MISSING이 됐다).
    body = src[re.search(r"<template>|return \(\s*\n", src).end():]
    body = re.sub(r"<!--.*?-->|\{/\*.*?\*/\}", "\n", body, flags=re.S)
    body = re.sub(r"<[^>]*>", "\n", body)             # 태그 하나가 경계다
    return prose_of(body.split("\n"))


def ko_dict_nodes():
    """`lib/i18n.ts`의 `ko` 사전 값을 `node`(이미 이 앱이 요구하는 런타임)로 직접 읽는다."""
    proc = subprocess.run(
        ["node", "-e", "import('./lib/i18n.ts').then(m => process.stdout.write(JSON.stringify(m.ko)))"],
        cwd=TEAMS_DIR,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        sys.exit(f"lib/i18n.ts의 ko 사전을 못 읽었다:\n{proc.stderr}")
    return prose_of(json.loads(proc.stdout).values())


ref = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_REF
src = subprocess.run(["git", "show", f"{ref}:{OLD}"], capture_output=True, text=True).stdout
if not src:
    sys.exit(f"{ref}:{OLD} 를 못 읽었다 — 이식 전 ref를 인자로 준다 (기본 {DEFAULT_REF})")
old = nodes(src)
new = nodes(open(NEW).read()) + ko_dict_nodes()
joined = " | ".join(new)
missing = [s for s in old if s not in joined and s not in REMOVED_NODES]
print(f"{ref} 산문 노드 {len(old)}개 / 사라진 것 {len(missing)}개 (지금 {len(new)}개)")
for m in missing:
    print("  MISSING:", m[:78])
sys.exit(1 if missing else 0)
