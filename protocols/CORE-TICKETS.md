# Writing ticket files - core

Read this before creating any ticket. **Wrong syntax = the ticket silently never
appears in the queue and waits forever.**

Same layer as `CORE.md` (the engine repo's `protocols/`). Not inlined into prompts -
**read it when you create a ticket.** Paths below are relative to the queue root;
where that root lives is the project docs' business.

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
| `deps:` | | `[a1b2c3d4, e5f6a7b8]`. Appears in the queue only when all are `.done` |
| `priority:` | | `1`-`5`. Missing/unreadable/out-of-range -> read as `3`, no queue migration needed. A ticket a higher-priority ticket depends on inherits that ticket's value (see project docs for the exact rule) |
| `duedate:` | | ISO 8601 datetime, e.g. `2026-08-14T18:00:00+09:00` (offset optional - read as local time if omitted). Absent/unreadable -> no deadline, no queue migration needed. Feeds the same priority machine as a clock: **≤5 hours remaining (including already past) -> treated as priority 5**, **≥7 days remaining (only on a ticket that has its own `duedate:`) -> treated as priority 1**. Between those two, the explicit `priority:` (or `3`) stands. Never rewrites `priority:` - the override is judgment-time only (see project docs for the exact rule) |
| `awaiting:` | | The **one answer stem** currently waited on. **Put the same value in `deps` too** - `deps` is the lock; this is what the GUI reads as "awaiting answer". Written by request-splitting sessions on `kind: request`, and by `reap` on tickets past the auto-reclaim cap (any kind). **Not deleted after the answer lands** (history) - whether still waiting is judged by the existence of `tickets/<awaiting>.done.md` |
| `req:` | | Source requirement stem, on tickets split from a requirement. Not `deps` - provenance, not ordering |
| `archives:` | | 대상 티켓의 스칼라 stem 하나. `deps:`처럼 목록(`[...]`)으로 쓰지 않는다. `resolveDep`가 `deps:`-`req:`와 같은 판정으로 푼다. 있으면 보드에서 독립 카드로 서지 않고 대상 티켓에 겹쳐 붙는다 |

Procedures for `awaiting:`/`req:` live in project docs (persona profiles, design doc).
The engine writes these keys in exactly one place - `reap`'s answer escalation
([CORE.md](CORE.md) §When blocked); the lock is always `deps`.

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
