# Core protocol

Inlined into every dispatch, beats project docs, persona profile, tickets on
conflict. Tail's autonomy note outranks this file, profile, AGENTS.md on
asking, blocking, approval, forbidden commands. Worker dir:
`<root>/worktrees/<worker>`.

## Ticket lifecycle

1. Read `.dira/tickets/<hash>.wip.md`. `## Goal` + `## Done when` are the
   contract.
2. Before anything else, append `## 진행 계획`: handoff-size steps, a
   checkbox per line: `- [ ] step` only; on start add ` (<start>)`, on check
   `)` -> ` -> <end>)`. ISO 8601+offset like `assigned_at`, from `date`, never
   pre-filled, no empty `( -> )`. `protocols/계획-규약.md`. **Push, retro,
   `## 결과`, `.done` rename aren't plan items.**
3. Do the work. Nothing outside `## Done when`. Flip one box `- [ ]` -> `- [x]`
   per edit, when true - never batched.
4. Append `## 결과` - what changed, how verified (one-line summary, not full
   output), pushed commit hashes.
5. Confirm push succeeded **and every `## Done when` box is `- [x]`** - one left
   `- [ ]` means the item isn't done or the flip was missed; settle it in `## 결과`
   first. **Then** rename to `<hash>.done.md`; skip it and the ticket stays
   incomplete. Only `mv` allowed: `.wip` -> `.done`.

### Retrospective (회고)

Only-this-session lesson -> `personas/<name>/memory/` (persona); none ->
skip. Fm `epic:` and true only inside it -> `epics/<value>/memory/` instead
(boundary: `epics.md`). Format: `CORE-MEMORY.md`.

## Ticket kinds - `kind:`

- `work` - instruction. Do it, `.done` it.
- `request` - ask/question. Answer with a new `kind: feedback` ticket, never
  appended to the original; `.done` it. A human demand splits into work
  tickets, each with `req: <original hash>` (not `deps`); once fully split,
  `.done` the original. Can't split without guessing -> ask back and drop,
  **not `## 블록`** (`CORE-TICKETS.md` - Asking back).
- `feedback` - report/critique. Recipient opens follow-ups or `.done`s it.

## Handoff

Someone else's area -> **new ticket**, never edit theirs, noted in `## 결과`
(`-> <new hash> (persona) what`). `deps` only if start needs it
(syntax: `CORE-TICKETS.md`).
Someone waits on it or it unblocks a `deps`: dispatch now, `CORE-DISPATCH.md`.

## When blocked

No guessing forward. Append `## 블록` - one-line summary, then a question in
`CORE-TICKETS.md` §Question format (`### <n>.` + `- (a)`). Exit leaving `.wip`, not `.done`. `reap` escalates
it (`CORE-TICKETS.md` - Asking back); re-dispatched -> read the `awaiting`
stem's `.done.md`, not the original.

Human calls: contradictory spec, read-only area, new external dep, push 3x
failed. Just a command to run, nothing to decide -> poll
(`workers/<w>.sh poll`), not a block. Waiting on a ticket -> `deps:` append +
`unassign` (`CORE-TICKETS.md` - Waiting on a ticket), not a block.

## Characters (특수문자)

Human-read text (ticket bodies, `## 결과`, `## 블록`, commits, docs) uses ASCII
punctuation only - not code under `apps/**`. Allowed set:

`` ` ~ ! @ # $ % ^ & * ( ) - _ = + [ ] { } \ | ; : ' " , . < > / ? ``

Outside it, never invent a substitute; exemptions: `CORE-TICKETS.md` - Characters.

Name a ticket by its bare 8-char hash (`547b7b98`), never a path.

## Queue invariants

Never break these; must break -> `## 블록`. **State is the filename**
(none / `.wip` / `.done`), never frontmatter. **Claim is an atomic link**, never
`os.rename`. **Queue is flat, single-copy, never in git** (`CORE-TICKETS.md`).
