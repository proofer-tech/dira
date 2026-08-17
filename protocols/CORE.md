# Core protocol

Inlined into every dispatch, not copied into the queue - engine and GUI read
it. Beats a project doc, persona profile, or ticket on conflict.

Worker dir: `<root>/worktrees/<worker>`.

## Ticket lifecycle

Your ticket is already claimed as `.wip`.

1. Read `.dira/tickets/<hash>.wip.md`. `## Goal` + `## Done when` are the contract.
2. Before anything else, append `## 진행 계획` - handoff-size steps, plain
   words (no code, no jargon), one checkbox per line:

   ```markdown
   ## 진행 계획

   - [x] step (2026-08-18T09:12:03+09:00 -> 2026-08-18T09:40:11+09:00)
   - [ ] step (2026-08-18T09:40:11+09:00)
   - [ ] step not yet started
   - [ ] ~~step abandoned~~ (2026-08-18T10:02:14+09:00 -> 2026-08-18T10:05:40+09:00)
   ```

   No timestamp = not started; `(<start>)` = in progress; `(<start> -> <end>)`
   + checked = done; `~~struck~~` = cancelled, unchecked. ISO 8601 + offset,
   like `assigned_at`; add `(<start>)` on start, `-> <end>` on check.
   **Locked once written** - no edits, no new items; plan goes wrong -> `~~`
   the rest and hand off as a new ticket (`## 결과`: `-> <new hash>`).
   **Lifecycle steps aren't plan items** - push, retrospective, `## 결과`,
   `.done` rename repeat on every ticket; the list holds only this ticket's
   own work.
3. Do the work. Nothing outside `## Done when`. Flip each box `- [ ]` -> `- [x]`
   the moment that item is actually satisfied - never in a batch at the end,
   never before it's true. The GUI reads progress from these boxes.
4. Append `## 결과` - what changed, verification commands + actual output, pushed
   commit hashes.
5. Confirm push succeeded.
6. Rename to `<hash>.done.md` - the completion report; skip it, ticket stays incomplete.

**`.done` only after push succeeds** - else unintegrated work is recorded as done.
Lost path: `ls .dira/tickets/<hash>.*`. Only `mv` allowed: `.wip` -> `.done`.

### Retrospective (회고) - before `## 결과`

Open `personas/<name>/memory/` (your persona); record what helps the next session.

- One concept, one file (`memory/<concept>.md`); exists -> edit, don't duplicate.
- Nothing to leave -> leave nothing.
- Don't repeat `docs/`/`AGENTS.md`, only what no doc records.

Format/example: `CORE-MEMORY.md`.

## Ticket kinds - `kind:`

- `work` - instruction. Do it, `.done` it.
- `request` - ask/question. Answer via a new `kind: feedback` ticket, never
  appended to the original; `.done` it. A human demand splits into work tickets
  instead of a reply - each gets `req: <original hash>` (provenance, not `deps`).
  Can't split without guessing -> add `## 질문 n`, set fm `awaiting: <new 8-hex>`
  AND append it to `deps:`, run `.dira/workers/<my worker>.sh unassign <original
  hash>`, exit (not `## 블록`; the answer is that stem's `.done` file). Fully
  split -> `.done` the original.
- `feedback` - report/critique. Recipient opens follow-ups or `.done`s it.

## Handoff

- Someone else's area -> **new ticket**, never edit theirs.
- Set `persona:`; hard order -> `deps: [<my hash>]` (syntax: `CORE-TICKETS.md`,
  same directory as this file - wrong syntax silently drops the ticket).
- Note it in `## 결과`: `-> <new hash> (persona) what was handed off`.
- `deps` only when start is impossible without it - overuse serializes the queue.

## When blocked

No guessing forward. Append `## 블록` - what you don't know, the options, what
must be decided - and **exit leaving the file `.wip`**, not `.done`.

`reap` auto-reclaims up to 2x, then appends `## 질문 n` + `awaiting:`, reopens
it; `deps` blocks workers until answered. Write `## 블록` as what a human must
answer. Re-dispatched after an answer -> read the `awaiting` stem's `.done.md`,
not the original.

Human calls: contradictory spec, read-only area, new dependency, push failed
3x, won't fit one session (propose a split, stop).

## Characters (특수문자)

Ticket bodies and anything written for a human (`## 결과`, `## 블록`, commit messages,
docs) use ASCII punctuation only - not code under `apps/**`. The allowed set:

`` ` ~ ! @ # $ % ^ & * ( ) - _ = + [ ] { } \ | ; : ' " , . < > / ? ``

Substitutions - left side never appears in new writing: `—`->`-`, `«`->`<`,
`»`->`>`, `→`->`->`, `·`->`-`, `…`->`...`, `×`->`x`, `–`->`-`, `※`->banned,
no replacement.

A symbol in neither the allowed set nor the list above (`§`, `✓`, `≤`, `≥`) is
undecided - don't invent a substitution, ask.

Already-written files aren't rewritten under this rule. Conversion is its own
ticket, tracked separately, **skipping the substitutions above**.

## Queue invariants

Never break these; convinced one must break -> `## 블록`.

1. **State is the filename** (none / `.wip` / `.done`) - never frontmatter.
2. **Claim is an atomic link** - never `os.rename`.
3. **The queue is flat, single-copy** - no subdirectories under `tickets/`, never in git.
