# Core protocol

Inlined into every dispatch, not copied into the queue. Beats a project doc,
persona profile, or ticket on conflict. Worker dir: `<root>/worktrees/<worker>`.

## Ticket lifecycle

1. Read `.dira/tickets/<hash>.wip.md` - already claimed for you. `## Goal` +
   `## Done when` are the contract.
2. Before anything else, append `## 진행 계획`: handoff-size steps in plain words,
   one checkbox per line - `- [ ] step (<start> -> <end>)`, ISO 8601 + offset like
   `assigned_at`, stamped `(<start>)` on start and `-> <end>` on check.
   **Locked once written** - no edits, no new items; plan goes wrong -> `~~strike~~`
   the rest unchecked and hand off a new ticket (`## 결과`: `-> <new hash>`).
   **Push, retrospective, `## 결과`, `.done` rename aren't plan items** - they repeat
   on every ticket; the list holds this ticket's own work.
3. Do the work. Nothing outside `## Done when`. Flip each box `- [ ]` -> `- [x]`
   the moment it is actually true - not in a batch at the end, not before.
4. Append `## 결과` - what changed, verification commands + actual output, pushed
   commit hashes.
5. Confirm push succeeded, **then** rename to `<hash>.done.md` - the completion
   report; skip it and the ticket stays incomplete. `.done` before push records
   unintegrated work as done. Only `mv` allowed: `.wip` -> `.done`.

### Retrospective (회고) - before `## 결과`

Leave what only this session learned in `personas/<name>/memory/` (your persona);
nothing to leave -> leave nothing. Rules + format: `CORE-MEMORY.md`.

## Ticket kinds - `kind:`

- `work` - instruction. Do it, `.done` it.
- `request` - ask/question. Answer with a new `kind: feedback` ticket, never
  appended to the original; `.done` it. A human demand splits into work tickets
  instead - each gets `req: <original hash>` (provenance, not `deps`), fully split
  -> `.done` the original. Can't split without guessing -> ask back and drop it,
  **not `## 블록`** (`CORE-TICKETS.md` - Asking back).
- `feedback` - report/critique. Recipient opens follow-ups or `.done`s it.

## Handoff

Someone else's area -> **new ticket**, never edit theirs, noted in `## 결과`
(`-> <new hash> (persona) what`). `deps` only when start is impossible without it -
overuse serializes the queue. Syntax: `CORE-TICKETS.md`.

## When blocked

No guessing forward. Append `## 블록` - what you don't know, the options, what must
be decided, as what a human must answer - and **exit leaving the file `.wip`**, not
`.done`. `reap` then escalates it with `## 질문 n` + `awaiting:` (`CORE-TICKETS.md`);
re-dispatched after an answer -> read the `awaiting` stem's `.done.md`, not the
original.

Human calls: contradictory spec, read-only area, new dependency, push failed 3x,
won't fit one session (propose a split, stop).

## Characters (특수문자)

Anything written for a human (ticket bodies, `## 결과`, `## 블록`, commits, docs) uses
ASCII punctuation only - not code under `apps/**`. The allowed set:

`` ` ~ ! @ # $ % ^ & * ( ) - _ = + [ ] { } \ | ; : ' " , . < > / ? ``

Outside it, never invent a substitution - the decided list and the exemption for
already-written files are in `CORE-TICKETS.md` - Characters.

## Queue invariants

Never break these; convinced one must break -> `## 블록`. **State is the filename**
(none / `.wip` / `.done`), never frontmatter. **Claim is an atomic link**, never
`os.rename`. **The queue is flat, single-copy** - no subdirectories under `tickets/`,
never in git.
