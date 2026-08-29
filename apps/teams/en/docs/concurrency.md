# How many to run at once

## Why there is no concurrency setting

If you are looking for a field that says "up to 3 at once," there is none. **The ceiling on
sessions running at the same time is the number of workers in this project's worker table.** With
one worker, no matter how many tickets pile up in the queue, it is one session at a time; with
two, it is two.

That table has two kinds mixed in: project workers this project made, and shared workers it
borrowed. The first kind belongs to this project, so the arithmetic holds as written. Shared
workers are slots that several projects take turns using, which changes things. **Three rows in
the table does not mean those three are running in this project at once.**

The `Limit` under `Borrow shared workers` means "at most this many." Set it to 3, and at any
moment when the pool is empty or other projects hold the slots, this project is using 0 shared
workers. So the ceiling has to be read this way to be accurate.

> The ceiling is the number of project workers plus the `Limit`, and that `Limit` share drops as
> low as 0 at any given moment.

There are two ways to add. For project workers it is [Workers](/docs/worker) §One press of
`New worker`, and for shared workers it is §Shared workers - slots that move between projects in
the same chapter. To make this one project go faster for certain, make a project worker. Shared
workers are the way to spend fewer slots when you have several projects.

## The worker lock - one ticket at a time

A worker is a synchronous process. That means it does one thing at a time, so it does not claim
the next ticket until the session for the one it claimed has ended.

Cron calls that worker every 30 seconds, but if the previous run still holds a session, this call
simply passes. The worker lock is what holds that spot. The lock is a mark saying "this worker is
working right now," and thanks to it two runs never take the same ticket at once and one worker
never starts two sessions.

While `w1` holds one ticket for 30 minutes, `w2` picks up other tickets in the meantime. That is
exactly the value of keeping several workers.

A session holding on forever is blocked too. Past 5400 seconds by default, the session is cut and
the ticket goes back to `Open`. The next call picks it up again, by the same worker or another.
The value to change is `TICKET_MAXRUN` in [Worker environment variables](/docs/ref-env).

## Three places where fewer run than you have workers

If you have five workers and only three are running, either the queue has no candidates or one of
the three below has caught them.

- **The persona cap.** That is `Limit` in [Personas](/docs/personas) §Dispatch policy. Set it to
  `2` and only two of that persona's tickets run at once even with ten backed up. A worker caught
  by the cap moves on to the next candidate of another persona, so one blocked persona does not
  starve the rest.
- **Priority 1.** A ticket whose effective priority is 1 is a candidate only while nothing is in
  progress. It means "pick this up only when it is quiet and nothing else is running," so keeping
  several workers on makes it run later, not sooner. Do not use 1 for something urgent.
- **A borrowed slot is off elsewhere.** A row with the `Shared` badge is not tied to this project.
  While that slot holds another project's ticket, it does nothing here. The rule for when its
  turn comes around is in [Workers](/docs/worker) §The rule that decides whose turn it is.

The first two leave one `SKIP` line in the log. The reason is written out, as in
`SKIP 페르소나 상한 <name> 2/2` and `SKIP 우선순위 1 <hash> — 진행중 3건`. Those lines come
from the engine and are in Korean whichever language you read the site in; what they say is that
a persona cap was hit at 2 of 2, and that a priority 1 ticket was passed over with 3 in progress.
Expand `Last activity` on the workers screen and you can see why nothing was taken, right there.

## Tokens and collisions - what grows along with it

Adding workers does not grow throughput alone.

- **Tokens.** Five workers running at once spend tokens five times over. The limit is one per
  machine and per account, so every worker drinks out of that one tank. There is no such thing as
  a per-worker limit anywhere. Register several accounts and turn on using them at once, and
  workers are divided among the accounts and the tanks divide with them
  ([Authentication](/docs/auth) §Multiplaying - the switches for keeping several accounts). If
  you use shared workers, sessions running in other projects drink from the same tank too. How
  much has been used and how much is left is in the token status bar at the bottom of the screen
  (see [The screens](/docs/screens)).
- **The risk of touching the same file at once.** Two different tickets can still step on the same
  source file or a shared dev database (four concurrent sessions once dropped a column). A
  separate git worktree per worker splits the source side, but a database or an external service
  does not split. The engine does not guard that area, and how many to keep is decided by a person
  who knows the risk.

Tokens can run higher than doing the same work yourself. The prompt is assembled from scratch
every time a session starts. The persona profile and the full protocol are loaded fresh each
time, and the session reads the ticket file itself on the spot too ([Personas](/docs/personas)
§How the prompt is assembled). When a person carries one conversation forward, that context is
loaded once. Ten tickets load it ten times. Finishing a ticket adds one more round: the session
checks whether it has memory to leave, and a separate archive ticket runs and reads and writes
that much more ([Archiving and the ontology](/docs/ontology)). All of this happens at once, as
many times over as you have workers.

Here is the size of it. Seven workers driven flat out without a break averaged 2.0M tokens per
minute. We have never measured doing it yourself, so the multiple is not written down.

Start at two, and add one at a time while the `Open` lane refuses to shrink. Five workers on an
empty queue gains you nothing and runs cron five times over.

Next is [Personas](/docs/personas).
