# frontmatter fields

The fields a person writes and the fields the dispatcher and the engine write are separate
([The states a ticket passes through](/docs/states) already drew that line). Do not fill an
engine-side value into a field a person writes. Fill in `session_id:` and the ticket looks
assigned, and once it does, no worker will pick it up.

## Fields a person writes

| Field | Required | What it means |
|---|---|---|
| `ticket` | ✓ | The hash. Keep it the same as the filename (without it, the filename is used) |
| `title` | ✓ | The title a person reads |
| `kind` | | `work`=an instruction / `request`=an ask / `feedback`=a report / `answer`=an answer file. For display; the value is not enforced |
| `persona` | | The name of the persona to do it. Without it, a plain agent with no persona handles the ticket. Only letters, digits, `-`, and `_` get through |
| `squad` | | The name of **one** squad to do it. Unlike `deps` it is not a list (`[...]`). The engine resolves this value, starts that group's leader, and overwrites `persona` with that name, so do not write it alongside `persona` ([Squads](/docs/squads)) |
| `deps` | | `[<hash>...]`, a hard ordering. The ticket appears in the queue only when they are all done |
| `priority` | | `1` to `5`. Missing, unreadable, or out of range reads as `3`. Higher goes first, and a prerequisite that a higher ticket waits on inherits that value |
| `duedate` | | An ISO 8601 time (`2026-08-14T18:00:00+09:00`; drop the offset and it is local time). Five hours or less remaining (including already past) reads as `5`, and seven days or more remaining, on a ticket that has its own `duedate`, reads as `1`. Between the two, the `priority` as written stands |
| `req` | | The hash of the original request, written on a ticket split out of one. It is provenance rather than ordering, which is what makes it different from `deps` |
| `epic` | | **One** number for the group this ticket belongs to (`P273`). Unlike `deps` it is not a list (`[...]`), and the value is not parsed either. The engine does not look at it; only the screen changes ([Epics](/docs/epics)) |
| `archives` | | **One** hash of the target ticket, written by an archive ticket. Unlike `deps` it is not a list (`[...]`). With this value the ticket does not stand as its own card on the board; it sits on top of the target ticket |
| `continued` | | **One** hash of the follow-up ticket a session handed the rest of its range to. Like `archives`, not a list (`[...]`). With this value the done badge turns into `Done (continued)` and becomes a link to that follow-up ([The states a ticket passes through](/docs/states)) |
| `handoffs` | | The number a handoff ticket writes to say which one it is. Add 1 to the previous ticket's value. A missing key reads as 0, so the first handoff is `1`. Once this value goes past `3` - that is, from the fourth handoff on - the engine puts the ticket back down the moment it takes it, and locks it into awaiting answer ([The states a ticket passes through](/docs/states)) |
| `polling` | | **One filename** of the polling script this ticket waits on. It is not a field for a path, so a `/` in it makes the engine refuse. The script goes under `polls/` below the queue root. While this value is not empty, that ticket stays out of the candidates even though it is open ([The states a ticket passes through](/docs/states)) |
| `polling_until` | | The cap on that wait. An ISO 8601 time (same format as `duedate`); past this time the engine stops polling and locks the ticket into awaiting answer |

## Fields the dispatcher and the engine write

| Field | When it is written | What it means |
|---|---|---|
| `session_id` | `assign` - **before** the engine starts | If it is there the ticket counts as assigned and drops out of the queue. This is the only value that judgment looks at |
| `assigned_at` | at the same time as `assign` | The time of assignment (used by reap's grace-period judgment) |
| `owner` | `assign` (automatic dispatch) or `handclaim` (taking it by hand) | Automatic gives `<persona or agent> / <worker>-<first 8 of the sid>`; a hand claim gives whatever identifier the caller passed |
| `pid` | `setpid` - **after** the engine starts in the background, or `handclaim` recording the ancestor `claude` pid | For the liveness check. It has nothing to do with dropping out of the queue |
| `inbox` | `setinbox` - **after** the first prompt has been fed in | The path of the interject FIFO. The FIFO file disappears when the session ends, but this value itself survives a normal completion and an automatic stale reclaim. Only `unassign` or a failed dispatch clears it |
| `claimed_at` | `handclaim` | The time it was taken by hand (used to grant a grace period against the idle check) |
| `transcript` | `handclaim` | The path of the newest transcript at that moment (for the idle check) |
| `attempts` | `reap` (up by one on every reclaim) | It counts up to two automatic reclaims, and resets to `0` when the ticket turns into a request for an answer. It [counts different events](/docs/screens) from the `Reassigned` line at the top right of the ticket detail |
| `awaiting` | when `reap` escalates it into a request for an answer (the third automatic reclaim, or immediately and regardless of the count if the last section of the body is a `## 블록`, the block section), and when a person cuts the session with `unassign --force` | A hash that does not exist. The same value goes into `deps` as well, and it is that `deps` that locks the queue. It clears itself once an answer file of the same name (`<awaiting>.done.md`) appears |
| `polled_at` | every time a worker runs the polling script once | The time of the last run. It is what keeps the interval written at the head of the script. No value means it has not run even once yet |
| `polling_fails` | when the polling script ends in an error | How many errors in a row. One success and the engine deletes this value. Reach `3` and that ticket is locked into awaiting answer too |

Sessions write `awaiting` too. A session splitting a request writes this value itself when it
cannot go further without guessing. It is not deleted after the answer arrives. It stays as a
record, and whether the wait is still on is judged by whether the answer file exists.

## Four rules outside the tables

Writing `5` in `priority` is a person's call. That value pushes aside a ticket that is already
running, so sessions only write `1` to `4`.

`duedate` does not rewrite `priority`. When a ticket is picked, the clock is read once and the
value goes up or down for that moment only. The number in the file stays as it is.

`kind: answer` is born done (`<awaiting>.done.md`). A person or the app creates it. Sessions never
create this file. Born open, it would dispatch to any worker at all as a ticket with no persona,
and nobody performs this file.

`polling` and `polling_until` sit among the fields a person writes, but they are not values you
open the file and fill in by hand. The session that decided to wait has the worker script write
them (`workers/<worker>.sh poll <hash> <script filename> <cap>`). The engine then runs five checks
before it puts the values in. It starts by looking for that file actually under `polls/`, and it
finishes by running the script once on the spot. If a single one fails it refuses without changing
a character of the file. Write them by hand and you skip all five, and a ticket pointing at a file
that is not there sits quietly open until the cap arrives.

## Where you fix them on screen - the `frontmatter` section of the ticket detail

There is one place to fix the keys in these tables without opening the file: the `frontmatter`
section at the top left of the ticket detail. It is the same row editor as the ontology cards,
with a key field and a value field on every line, and it works exactly as
[Archiving and the ontology](/docs/ontology) describes. When you have made your change, press
`Save` at the bottom right of the section.

**Only open tickets can be fixed.** In progress (`.wip`) and done (`.done`) get a read-only table
instead of rows. It is the same door that locks the body editing form - if the screen changes a
file from outside while a session is holding it, the values that session just read no longer
match.

What comes up as rows is `deps`, `req`, `epic`, `awaiting`, `continued`, `archives`, `handoffs`,
and any key you added yourself that is not in these tables. The rest fall into two groups.

- **The six the editing form already holds** - `title`, `kind`, `persona`, `squad`, `priority`,
  `duedate`. The editing form on the right is the source, so they do not appear in the frontmatter
  section. Fix the same key in both places and whichever you saved later quietly wins.
- **The execution keys the engine stamps** - visible in the table below, but not editable.

### Keys you can see but cannot fix

Below the row list sits one more small table. These are not values a person decides but facts the
engine stamped, so they are read-only. Change one by hand and the claim of the session running
right now breaks on screen.

The keys here are `ticket`, `session_id`, `assigned_at`, `pid`, `owner`, `inbox`, `attempts`,
`claimed_at`, `transcript`, `polled_at`, `default_answer`, and the three that start with `polling`
(`polling`, `polling_until`, `polling_fails`).

`polling` and `polling_until` are here for the reason written in 'Four rules outside the tables'
above. Those values go in only after the worker script has passed all five checks.

The table shows down to `assigned_at` and you open the rest with `Expand`. A key that is not in
the file has no line at all. On a ticket that was never claimed, this table does not appear at all.

### No checking here either

The value field of `deps:` and `req:` offers the ticket hashes in this queue as candidates. The
candidates are only there to make picking easier, so a hash that does not exist saves fine if you
type it in. The screen does not check the rules in these tables - it will not stop you writing
`squad` and `persona` together, or putting a list in `epic`. How a wrong value gets read is exactly
what the two tables above say.

The ticket screen has no `Switch to plain text` handle for seeing the whole source. When you have
to see the frontmatter source as it is, open the file yourself.

---

That is the manual. The place where you end up writing these tables by hand is
[Writing a ticket yourself](/docs/ticket-writing).
