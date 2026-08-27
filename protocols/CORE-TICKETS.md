# Writing ticket files - core

Read this before creating any ticket. **Wrong syntax = the ticket silently never
appears in the queue and waits forever.** It also holds what `CORE.md` points here
for: asking back on a requirement, the character substitutions, and the banned
expressions.

Same layer as `CORE.md` (the engine repo's `protocols/`). Not inlined into prompts -
**read it when you write into a ticket file.** Paths below are relative to the queue
root; where that root sits is the project docs' business.

## Creating

```bash
H=$(python3 -c 'import uuid;print(uuid.uuid4().hex[:8])')
cat > "<queue>/tickets/$H.md" <<EOF
---
ticket: $H
title: one line - what this does
kind: work
persona: developer
deps: [a1b2c3d4]
---

## Goal
Why + what to build. 2-4 lines.

## Done when
- [ ] a verifiable sentence
- [ ] a verifiable sentence

## 참고
- related doc / ticket paths
EOF
echo "$H"
```

Never mint the hash with `$RANDOM` or by typing one - on collision `find` returns the
wrong ticket.

## frontmatter

| key | req | value |
|---|---|---|
| `ticket:` | ✓ | 8-char hex. **Must equal the filename** |
| `title:` | ✓ | One human-readable line, no quotes. `:` must be followed by a value |
| `kind:` | | `work` \| `request` \| `feedback` \| `answer` |
| `persona:` | | A persona the project defines (under `<queue>/personas/`). Absent -> dispatched persona-less (normal) |
| `deps:` | | `[a1b2c3d4, e5f6a7b8]`. Appears in the queue only when all are `.done`. Overuse serializes the queue - set only when start is genuinely impossible without it |
| `priority:` | | `1`-`5`. Missing/unreadable/out-of-range -> read as `3`, no queue migration needed. A ticket a higher-priority ticket depends on inherits that ticket's value (see project docs for the exact rule) |
| `duedate:` | | ISO 8601 datetime, e.g. `2026-08-14T18:00:00+09:00` (offset optional - read as local time if omitted). Absent/unreadable -> no deadline, no queue migration needed. Feeds the same priority machine as a clock: **≤5 hours remaining (including already past) -> treated as priority 5**, **≥7 days remaining (only on a ticket that has its own `duedate:`) -> treated as priority 1**. Between those two, the explicit `priority:` (or `3`) stands. Never rewrites `priority:` - the override is judgment-time only (see project docs for the exact rule) |
| `awaiting:` | | The **one answer stem** currently waited on. **Put the same value in `deps` too** - `deps` is the lock; this is what the GUI reads as "awaiting answer". Written by request-splitting sessions on `kind: request`, and by `reap` on tickets past the auto-reclaim cap (any kind). **Not deleted after the answer lands** (history) - whether still waiting is judged by the existence of `tickets/<awaiting>.done.md` |
| `req:` | | Source requirement stem, on tickets split from a requirement. Not `deps` - provenance, not ordering |
| `archives:` | | 대상 티켓의 스칼라 stem 하나. `deps:`처럼 목록(`[...]`)으로 쓰지 않는다. `resolveDep`가 `deps:`-`req:`와 같은 판정으로 푼다. 있으면 보드에서 독립 카드로 서지 않고 대상 티켓에 겹쳐 붙는다 |
| `squad:` | | 스칼라 하나 - `squads/<이름>/members`의 스쿼드 이름. `persona:`와 둘 다 있으면 `squad:`가 이긴다. 손으로 고정하려면 `squad:` 줄을 지운다 - 스쿼드 티켓의 `persona:`는 입력이 아니라 기록이다(§5-5) |

The engine writes these keys in exactly two places now (§5-5 승인 이후 - 자리가 둘이 됐다):
`reap`'s answer escalation - after auto-reclaiming a ticket twice it reopens it carrying
`## 질문 n` + `awaiting:`, and `deps` holds every worker off until the answer lands
([CORE.md](CORE.md) §When blocked); and `claim`'s squad resolution - a `squad:` ticket's
`persona:` is overwritten with the resolved leader's name right after claim. The lock for
the first is always `deps`.

**Sessions write `priority:` only as `1`-`4`.** `5` preempts another worker's
in-progress ticket - that's a human-only call, not one a session makes on its own.

**`kind: answer` is created by a human/GUI and is born `.done`** - created as
`tickets/<A>.done.md` at the requirement's `awaiting:` stem (`title: 답변 - <R> #n`).
Born open, it would dispatch to any worker as a persona-less ticket; nobody performs
it, hence `answer`, not `feedback`. Sessions never create this file. It is the
request-roundtrip form of "answers go in a new file, never appended to the original"
([CORE.md](CORE.md) §Ticket kinds).

`session_id:` `assigned_at:` `owner:` `attempts:` `pid:` `claimed_at:` `transcript:`
`inbox:` are **written by the dispatcher - never set them yourself.** A new ticket
carrying `session_id:` looks assigned and is never dispatched.

## Asking back on a `kind: request`

Referenced from [CORE.md](CORE.md) §Ticket kinds - the four steps a session runs
when a requirement can't be split without guessing. **Not `## 블록`**: the answer
is the answer stem's `.done` file, and a fresh `## 블록` parks the ticket instead.
Stopping halfway leaves the requirement stuck with nobody waiting on it.

1. Append `## 질문 n` to the request body (`n` = the round) - what you don't know,
   and what the answer decides. **Setting `awaiting:` without this section is
   banned** - the screen then says "awaiting answer" without showing the question.
   How options are written is the project's business (persona profiles, design
   doc) and a screen may parse that shape.
2. Mint the answer stem and edit the frontmatter twice: `awaiting: <new 8-hex>`
   (overwrite if already there) and **append** that stem to `deps:`, keeping the
   existing deps. Both - `deps` is the actual lock, `awaiting:` is what the GUI
   reads as "awaiting answer".
3. `<queue>/workers/<my worker>.sh unassign <request hash>` - the worker is in
   your own `owner:` (`pm / w3-...` -> `w3`). Never rename the `.wip` yourself.
4. Exit. Don't `.done` it. Once `tickets/<stem>.done.md` exists the dep is met and
   the request comes back; read that file, not the original.

Round 2 overwrites `awaiting:` with a new stem and appends that one to `deps:` as
well. Never delete `awaiting:` after an answer lands - it is history.

Procedures for `req:` are in project docs (persona profiles, design doc).

## Pitfalls

- **First line not `---`** -> read as having no frontmatter, excluded from the queue.
  A leading blank line fails the same way.
- **No closing `---`** -> same. Parse failure = silent loss.
- **A typo hash in `deps`** -> the dep is never found -> conservatively judged
  "incomplete" -> waits forever. Check first: `python3 tickets.py find <queue> <hash>`.
- **No state suffix in the filename.** Create `<hash>.md`. `.wip`/`.done` belong to
  the dispatcher and to your own completion rename only.
- **No subdirectories.** Directly under `tickets/`. The queue is flat.

## Verify

After creating, confirm it shows up:

```bash
<queue>/workers/<worker>.sh list
```

`대기` = success. Not visible -> broken frontmatter or a stray suffix.
`deps 대기 <hash>` = normal (appears once the prerequisite finishes).

## Characters (특수문자)

Referenced from [CORE.md](CORE.md) §Characters, which carries the rule (ASCII
punctuation only in anything written for a human) and the allowed set. This is the
decided substitution list - **the left side never appears in new writing**:

| don't write | write |
|---|---|
| `—` `–` `·` | `-` |
| `→` | `->` |
| `«` `»` | `<` `>` |
| `…` | `...` |
| `×` | `x` |
| `※` | banned, no replacement |

A symbol in neither the allowed set nor this table (`§`, `✓`, `≤`, `≥`) is
undecided - don't invent a substitution, ask.

Already-written files aren't rewritten under this rule. Conversion is its own ticket,
tracked separately, **skipping the substitutions above** - a mass rewrite of prose
that already reads fine is churn, and the diff hides the edits that matter.

## Words (금지 표현)

Referenced from the `추가 금지 표현` block inlined into every dispatch, which carries the
rule (no living verb on an inanimate subject - it isn't here because `CORE.md` is at its
3,500 B budget). This is the decided replacement list - **the left side never appears in
new writing**:

| don't write | write |
|---|---|
| `A는 B에 산다` `삽니다` | `A는 B에 있다` `A를 B에 둔다` `B가 A를 갖는다` |
| `사는 자리` `사는 곳` | `있는 자리` `두는 자리` `놓이는 자리` |
| `그대로 산다` (효력이 남는다) | `그대로 남는다` `그대로 유효하다` |
| `안 산다` (성립하지 않는다) | `성립하지 않는다` `안 통한다` |
| `살아난다` (버튼/칸이) | `켜진다` `눌릴 수 있게 된다` |
| `앉는다` `앉힌다` `앉을 자리` | `붙는다` `들어간다` `놓인다` `들어갈 자리` |
| `선다` `서 있다` `세운다` (화면 요소가) | `뜬다` `생긴다` `그려진다` `성립한다` `만든다` |
| `말한다` `말해 준다` (화면/제목/문서/수가) | `보여준다` `알려 준다` `적혀 있다` `가리킨다` |
| `숨 쉰다` `깨어난다` `자리 잡고 산다` | banned, no replacement |
| `못박는다` `못박았다` `못박은` | `고정한다` `정했다` `명시했다` `정한` |
| `값을 박는다` `해시가 박혀 있다` | `값을 넣는다` `해시가 적혀 있다` |
| `스펙에 박았다` `절이 박은 값` `박혀 있다` | `스펙에 적었다` `절이 적은 값` `적혀 있다` |
| `못 5` `뽑은 못` `못 하나` (고정된 규칙) | `규칙 5` `뽑은 규칙` `규칙 하나` `결정 하나` |

The exception is a real process, session, or pid - `pid가 살아 있다`, `세션이 아직 살아
있다`, `부모가 wait에 서 있다` stay as they are, and so does any sentence whose subject is a
person. A ticket, file, or setting is not a live thing: write `열려 있는 동안`, `그대로
남는다`. `박다`/`못박다` is banned as a metaphor for fixing a rule or a value (the vendored
guidance's own example: `코드로 박는 자리 -> 코드에 명시하는 상황`); the noun `못` is banned
for the same reason - a fixed rule is `규칙 5`, not `못 5`, and `못 5를 깬다` is `규칙 5를
어긴다`. The negation adverb `못` (`못 읽는다`, `못 지운다`) is not covered by this rule.

**`박` is also a noun in this codebase** - one beat of the heartbeat (`webhookTick`), as in
`이 박에서`, `재획득 박은`, `매 박마다`, `박을 이었다`. That noun is not this rule's target;
only the verb `박다` is. A sweep that substitutes on the bare syllable `박` breaks it, and has
broken it once already (`4d259d16` turned `문서는 못 찾는다` into `문남는 규칙 찾는다` and
mangled a verbatim human quote). Match the verb's endings, never the bare syllable - the same
caution applies to `못`, whose negation-adverb sense outnumbers the banned noun by ten to one.

Already-written files aren't rewritten under this rule - the §Characters clause above
applies here word for word.
