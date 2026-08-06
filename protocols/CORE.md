# Core protocol

Inlined into every dispatch; no copy in the queue. The engine (`tick.sh`, `tickets.py`)
and the GUI read it — breaking it **corrupts the queue**. If a project doc,
persona profile, or ticket contradicts it, **this file wins.**

Worker directory: `<root>/worktrees/<worker>` — name = directory, so two workers
never share a tree.

## Ticket lifecycle

Your ticket is already claimed as `.wip`.

1. Read `.dira/tickets/<hash>.wip.md`. `## Goal` + `## Done when` are the contract.
2. Do the work. Nothing outside `## Done when`.
3. Append `## 결과` — what changed, verification commands + actual output, pushed
   commit hashes.
4. Confirm the push succeeded.
5. Rename to `<hash>.done.md`. The rename is the completion report; skip it and the
   ticket stays incomplete.

**`.done` only after push succeeds** — else unintegrated work is recorded as done.
Lost the path: `ls .dira/tickets/<hash>.*`.
Only state `mv` allowed: your own `.wip` → `.done`.

### Retrospective (회고) — before `## 결과`

Open `personas/<name>/memory/` (your persona); record what would have saved the next
session time.

- One concept, one file (`memory/<concept>.md`); exists → edit, don't duplicate.
- Nothing to leave → leave nothing.
- Don't repeat `docs/`/`AGENTS.md` — only what no doc records.

Format + example: sibling `CORE-MEMORY.md`.

## Ticket kinds — `kind:`

- `work` — instruction. Do it, `.done` it.
- `request` — ask/question. Answer with a new `kind: feedback` ticket; never
  append to the original, `.done` it. A human demand is split into work tickets,
  not replied to — each gets `req: <original hash>` (provenance, not `deps`).
  Cannot split without guessing → add `## 질문 n`, set fm `awaiting: <new 8-hex>`
  AND append it to `deps:`, run `.dira/workers/<my worker>.sh unassign <original
  hash>`, exit (not `## 블록`; the answer arrives as that stem's `.done` file).
  Fully split → `.done` the original.
- `feedback` — report/critique. Recipient opens follow-ups or `.done`s it.

## Handoff

- Someone else's area → **make a new ticket.** Never edit others' tickets — `.wip` means
  someone is in that file now.
- Set `persona:`; hard ordering → `deps: [<my hash>]`. Syntax: `CORE-TICKETS.md` in
  this block's header directory. Wrong syntax silently drops the ticket from the queue.
- Note it in your `## 결과`: `-> <new hash> (persona) what was handed off`.
- `deps` only when start is impossible without it — overuse serializes the queue.

## When blocked

No guessing forward. Append `## 블록` — what you don't know, the options, what must
be decided — and **exit leaving the file `.wip`**, not `.done`.

`reap` auto-reclaims up to 2×, then appends `## 질문 n` + `awaiting:` and reopens it;
`deps` keeps workers off until answered. Write `## 블록` as **what a human must
answer** — it becomes the question.

Re-dispatched after an answer: read the `awaiting` stem's `.done.md` first — the
answer lives there, not on the original.

Human calls: contradictory spec / read-only area / new dependency / push failed 3× /
won't fit one session (propose a split, stop).

## Queue invariants

Never break these; convinced one must break → `## 블록`.

1. **State is the filename.** None / `.wip` / `.done`. Never move state into
   frontmatter.
2. **Claim is an atomic link** — never `os.rename`.
3. **The queue is flat, single-copy.** No subdirectories under `tickets/`; the queue
   never goes into git.
