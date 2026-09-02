# How many to run at once

## This project's ceiling - the number of workers

If you are looking through the project settings for a field that says "up to 3 at once," there is
none. **The ceiling on sessions running at the same time in this project is the number of workers
in its worker table.** With one worker, no matter how many tickets pile up in the queue, it is one
session at a time; with two, it is two. Every worker in that table belongs to this project, so
the arithmetic holds as written.

There is one more ceiling. **It applies to this whole computer**, and every project you have
registered shares that single value. It is counted separately from the worker count, so the next
section takes it on its own.

To make this project go faster, make a worker. The place is [Workers](/docs/worker) §One press of
`New worker`.

## This computer's ceiling - the machine-wide session limit

Register several projects and the worker counts, added up, pass ten in a hurry. One session is one
copy of claude, so six of them up at once take six copies' worth of CPU and memory. That is why
one more limit sits above the project ceiling. **It is how many sessions can be up at once on this
computer, and every registered project shares that one value.** The default is 6.

What this limit counts is the sessions alive right now. It does not look at the number of workers.
However many workers you have, if only four of them are holding tickets, four sessions are alive.

### How many are up right now - `Settings` › `Workers`

Open `Settings` with the gear at the far right of the header and pick `Workers`, at the bottom of
the `Setting categories` group in the left tree. The top section of the panel is
`Machine-wide session limit`. It sits above the two filters and the `All workers` list.

Three things are there.

- **The value next to `Limit`.** The limit in force right now. If you have never set one, `None`
  shows.
- **The total line.** `Machine-wide 4/6` puts the number of live sessions and the limit together.
  With the limit at `None`, only the session count shows, with no denominator.
- **One line per queue.** Every registered project gets a line, and one using none of them
  reads `0`. The total alone cannot tell you whether all six landed in one project or spread
  across three. This list is where you check that.

Once the total reaches the limit, one more line appears below it.

> `At the limit — no new sessions can start right now.`

If the value cannot be read, it is taken as no limit, and
`Couldn't read session-limit — reading it as no limit.` shows under `Limit`.

This panel reads once, when the dialog opens. The numbers do not move while it is open, so close
it and open it again.

### Where you change it - `Limit` in that same section

Press the value next to `Limit` and a popover opens. Put an integer into
`Concurrent session limit` and press `Save`.

> `Empty removes the limit — caps how many claude sessions run at once on this machine.`

**Save it empty and the limit itself goes away.** That differs from `0`. `0` blocks every session
from starting; empty puts no limit on at all.

The default of 6 was not measured on your computer. It came off the machine this was built on, so
raise it if you have more cores and memory to spare. Lower it if you run other work alongside it,
and lower it again if the machine gets sluggish after you raise it.

### When you make a worker - the number shows under the name field

Press `New worker` and two helper lines appear under the name field. The upper one is the number
right now (`Machine-wide 4/6`), or `No machine-wide limit` if you have never set one. The lower
one is what that number means.

> `Running many sessions at once strains this machine, so there's a limit on how many can run concurrently.`

**`Create` does not lock even with the number sitting at the limit.** Making one more worker and
starting one more session are different things. A worker is a spot that claims a ticket; a session
is the claude actually up in that spot.

Blocking by worker count would cause a different problem right away. Add up the workers across
every registered project and it passes twenty while the limit is 6, so the moment you block on
worker count, `Create` would be unpressable in every project. What you need when the limit is
reached is to know how many are up right now, which is why this form shows you the number instead
of blocking.

The other direction holds too: while you are stuck at the limit, more workers will not make this
project run faster. It is not running because there is no spot, and adding hands to claim tickets
does not add spots.

### Telling whether the limit is what is starving you

When tickets are piling up in the queue and nothing is running, two places will tell you in turn
whether this limit is the cause.

Look at the total in `Settings` › `Workers` first.

- **The total has reached the limit.** This computer is full. Who is using those spots is in the
  per-queue list right below it. It is usually another project, so wait, raise the limit, or stop
  that project's workers.
- **The total is under the limit and still nothing runs.** The limit itself still has room. One
  more line of the log has to be read.

Two different sentences get written to `<root>/workers/runner.log` (see [Logs](/docs/logs)). They
come from the engine and are in Korean whichever language you read the site in.

| Log line | What it says |
|---|---|
| `상한 - 머신 전체 산 세션 6/6, 이번 tick을 건너뜀` | The machine is full, so this round did not run |
| `몫 - 이 큐가 2벌로 몫 2를 채웠고 굶는 큐가 있어 이번 tick을 양보함` | The limit has room, but this project had already filled its share, so it handed the spot to a project that has none up |

With neither of them there, this limit is not the cause. Look at the first three of
§Three places where fewer run than you have workers below. Those two lines skip only that round
without touching the ticket. The ticket stays in `Open` and is a candidate again next round.

### The share - so one project cannot eat the whole limit

If the limit were first-come only, the project with more workers would keep taking each free spot
back and the project with fewer would starve with its tickets piled up. That happened. Five of the
six live sessions belonged to one project, and the project sitting on five open tickets had none.

So the limit is divided into shares. **A share is the limit divided by the number of projects that
have work right now, and never less than 1.** With a limit of 6 and three projects holding work,
the share is 2; with seven, it is 1. A project that has already filled its share skips the round
whenever another project has work and nothing up.

- **With nobody starving, the leftover spots stay first-come.** With a limit of 6 and four
  projects holding work, the share is 1 and the remaining two spots go to whoever gets there
  first. The division never leaves spots empty.
- **Two conditions make a project count as holding work.** It has at least one open ticket or one
  in-progress ticket whose owner has died, and its workers actually ran within the last two
  minutes. A project sitting on tickets with its workers switched off does not count. Counting it
  would leave the spot reserved for its share with nobody to take it.
- **Each project's own workers make this call.** No table of turns is kept anywhere, so adding or
  removing a project leaves nothing to reconcile.

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
- **The machine-wide session limit.** This one catches you because of other projects, which makes
  it unlike the first two. Either this computer is already full, or the limit has room and this
  project has spent its whole share. How to tell them apart is in
  §Telling whether the limit is what is starving you above.

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
  ([Authentication](/docs/auth) §Multiplaying - the switches for keeping several accounts).
  Sessions running in other projects drink from the same tank too. How much has been used and how
  much is left is in the token status bar at the bottom of the screen
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
empty queue gains you nothing and runs cron five times over. If you are running several projects,
look at the total in `Settings` › `Workers` once before you add. Already at the limit, more
workers have no spot to come up in.

Next is [Personas](/docs/personas).
