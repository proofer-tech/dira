# 티켓 파일 작성법

새 티켓을 만들기 전에 읽는다. **문법이 틀리면 조용히 큐에서 안 보이고 영구 대기한다.**

## 만드는 절차

워크트리 안에서 그대로 돌린다(`.fs-tickets`는 canonical 큐로 가는 심링크다).

```bash
H=$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')
cat > ".fs-tickets/tickets/$H.md" <<EOF
---
ticket: $H
title: 한 줄 제목 — 무엇을 하는지
kind: work
persona: developer
deps: [a1b2c3d4]
---

## Goal
왜 필요한지 + 무엇을 만드는지. 2~4줄.

## Done when
- [ ] 검증 가능한 문장
- [ ] 검증 가능한 문장

## 참고
- 관련 문서·티켓 경로
EOF
echo "$H"
```

해시를 만들 때 `$RANDOM`이나 직접 타이핑을 쓰지 않는다 — 충돌하면 `find`가 엉뚱한 티켓을 준다.

## frontmatter

| 키 | 필수 | 값 |
|---|---|---|
| `ticket:` | ✓ | 8자 hex. **파일명과 같아야 한다** |
| `title:` | ✓ | 사람이 읽는 한 줄. 따옴표 없이. `:` 뒤에 값이 있어야 한다 |
| `kind:` | | `work` \| `request` \| `feedback` |
| `persona:` | | `pm` \| `designer` \| `developer` \| `qa`. 없으면 페르소나 없이 디스패치(정상) |
| `deps:` | | `[a1b2c3d4, e5f6a7b8]`. 전부 `.done`이어야 큐에 뜬다 |

`session_id:`·`assigned_at:`·`owner:`·`attempts:`·`pid:`·`claimed_at:`·`transcript:`는
**디스패처가 쓴다. 사람이 넣지 않는다.** 새 티켓에 `session_id:`를 넣으면 할당된 것으로 보여
영원히 디스패치되지 않는다.

## 함정

- **첫 줄이 `---`가 아니면** frontmatter가 없는 것으로 보고 큐에서 제외된다. 앞에 빈 줄도 안 된다.
- **닫는 `---`가 없으면** 같다. 파싱 실패 = 조용한 유실.
- **`deps`에 오타 해시**를 쓰면 그 티켓을 못 찾고 → 보수적으로 "미완료"로 판정 → 영구 대기.
  적기 전에 `python3 tickets.py find .fs-tickets <해시>`로 존재를 확인한다.
- **파일명에 상태 접미사를 넣지 않는다.** `<해시>.md`로 만든다. `.wip`·`.done`은 디스패처와
  당신의 완료 신고만 쓴다.
- **하위 디렉터리에 만들지 않는다.** `tickets/` 바로 아래다. 평면 큐다.

## 확인

만든 뒤 반드시 큐에 뜨는지 본다:

```bash
.fs-tickets/workers/w1.sh list
```

`대기`로 보이면 성공. 안 보이면 frontmatter가 깨졌거나 접미사가 붙었다.
`deps 대기 <해시>`로 보이면 정상(선행이 끝나면 뜬다).

## 쪼개는 기준

한 티켓 = **한 세션(5~25분) = 리뷰 가능한 하나의 변경**.

- 화면 하나, 레이어 하나, 검증 하나. "화면 3개 + 테스트"는 4개 티켓이다.
- `## Done when`이 6개를 넘으면 쪼갤 신호다.
- 쪼갠 것들 사이에 하드 선후가 있을 때만 `deps`로 엮는다. 병렬 가능한 건 병렬로 둔다.
