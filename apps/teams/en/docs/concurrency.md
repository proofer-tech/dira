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

## Selfish mode - giving this computer to the queue while you sleep

This is the mode you switch on before you leave for the day or go to bed. It quits the apps you
have open and hands the CPU and memory they were using to the sessions. Turn it on while you are
working with a browser and a chat app open and whatever you were doing closes, so leave it off
during working hours.

It lives in `Settings` › `Workers`, in the `Selfish mode` section right below
`Machine-wide session limit`. Like the limit, it is a value for this computer, so project
settings do not have it.

### Turning it on now, and a daily schedule

To turn it on right away, press `Turn on now`. A 60-second countdown appears with the list of apps
that will be quit. If you see one in the list that must stay up, press `Cancel` before the countdown
ends. Nothing changes. Once the 60 seconds pass the mode is on, and the button in the same spot
becomes `Turn off`. Press `Turn off` and it switches off on the spot, but the apps it quit do not
come back up.

To switch it on and off at the same times every day, set a start time and an end time in the same
section and save. The default is on at 23:00 and off at 07:00. If it is already on at the start
time, that run is skipped. If it is on at the end time, it is switched off.

The moment you save a schedule, and the moment you press `Turn on now`, macOS asks once whether the
dira app may control other apps. If that prompt first showed up at 11 p.m. on a screen nobody is
watching, the mode would not switch on, so the question is asked up front. Allow it. If you deny
it, the section says so and the schedule is not saved.

### Which apps go down and which stay

What gets quit is the ordinary apps, the ones with an icon in the Dock. Daemons and input methods
running in the background with no window are left alone.

These are on the exclusion list by default and stay up.

- The dira app itself, `Finder`, `Terminal`, `iTerm2`
- `Google Drive`, `Amphetamine`, `1Password`, `1Password 7`
- Any app with `VPN` in its name

If there is an app that has to keep running overnight, add its name to the exclusion list in the
section. To let one of the defaults be quit, remove it from the list.

**Nothing is force-quit.** Each app gets one ordinary quit request and 10 seconds. An app holding a
document you have not saved stays up with its "save changes?" prompt on screen, and the mode notes
it as one it could not quit. This is so you do not lose the document. If you want an app down
overnight, save your work in it before you turn the mode on.

### Leave the limit empty

The section has a field for a limit. Put an integer in it and, while the mode is on, the
machine-wide session limit from §This computer's ceiling above is changed to that value, then put
back to what it was when the mode switches off. If there was no limit before, there is none after.
**Leave it empty and the limit stays as it is; only the apps are quit. Empty is the default.**

The reason to leave it empty is that nobody has measured a number yet. First see how much more gets
done with the apps out of the way, then decide whether to raise the limit. If the last-run box shows
a lot of runs skipped because of the limit, that is the time to try a higher one.

Changing the limit only raises how many sessions actually run in projects carrying the hook that
reads the machine limit (`.dira/session-cap.sh`). Quitting apps helps every registered project.

### In the morning - the last-run box

Each time the mode switches off, the section's `Last run` box is filled in again. It shows only the
most recent run.

- **From when to when** it was on
- **How many apps it quit, and the names of the ones it could not.** A name here most likely means
  a document is still unsaved. Open that app and look.
- **One line per project.** Dispatches, completions, the STALL ratio, runs skipped because of the
  limit, sessions killed by the account limit, and the time of the last dispatch.

The numbers are counts of lines written to each project's `<root>/workers/runner.log` during that
window. If many sessions died on the account limit, the account ran dry before the computer did;
see [Authentication](/docs/auth) §Multiplaying - the switches for keeping several accounts. If the last dispatch stopped early in the night,
the queue ran out of tickets or something else held it up.

### With the app closed, the schedule does not run

**The schedule only runs while the dira app is open.** The clock it keeps is a heartbeat inside the
app, so with the app closed the mode does not switch on when 23:00 comes. If you closed the app
with the mode on, it does not switch off at 07:00 either. In that case, the next time you open the
app its first heartbeat runs the missed slot once, switches the mode off, and puts the limit back.
To use it overnight, leave the dira app open.

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

## Immediate dispatch - starting a worker now instead of waiting for cron

Cron calls the workers every 30 seconds, so a ticket you make and leave alone gets picked up within
30 seconds. Immediate dispatch shortens that wait. If it does not start a worker, nothing is lost:
the next cron round does the same work.

Whether to start a worker, and which one, is decided in one place: the engine's `dispatch.py`.
Cron, the screens, MCP, and sessions all call it, and none of them picks a worker on its own. Once
a worker is up, `tick.sh` still decides which ticket it takes, as before.

### The four reasons - who calls, and when a worker starts

Every caller attaches a reason. Each reason checks different conditions.

| Reason | Called from | Starts a worker when |
|---|---|---|
| `cron` | Each worker's crontab line | That worker is idle. Load and other candidates are not checked. With no candidate, `tick.sh` simply ends |
| `request` | The moment a request (`kind: request`) ticket is made: the ticket-creation action on screen and MCP `ticket_create` | All four hold: load is at or under the limit, an idle worker exists, there are zero candidates other than that ticket, and that ticket is a candidate |
| `direct` | MCP `dispatch_now`, the kicks on screen, a command a person runs | With a hash, that ticket is a candidate and an idle worker exists. Without one, an idle worker is enough. Load and other candidates are not checked |
| `judge` | A session, on its own, following the engine guidance | The same four conditions as `request` |

`request` and `judge` start nothing while the queue holds even one other candidate. The new ticket
does not jump ahead of tickets already waiting; it waits for its cron turn. `direct`, on the other
hand, means a person or a screen said "now," so it skips the load and other-candidate checks.

A session calls with `judge` in three cases: a person in the current conversation is waiting on a
ticket it just made, the ticket it is closing clears another ticket's `deps`, or its own handoff
has to finish before its continuation can go. For any other new ticket it does not call and leaves
the pickup to cron.

An idle worker is one whose worker file is registered in crontab and whose worker lock is not
held. When several are idle, the first by name in ascending order is picked. The worker lock is
covered in §The worker lock above.

### Changing the load limit - `~/.config/dira/dispatch.json`

Only `request` and `judge` check load. If this computer's one-minute load average (the first
number `uptime` shows) is above the limit, no worker starts. The default limit is this computer's
CPU core count.

To change it, create `~/.config/dira/dispatch.json` and put a number in `load_max`.

```json
{ "load_max": 6.0 }
```

With no file, or no `load_max` key, the limit goes back to the core count. No screen edits this
value. Watch the `KICK-SKIP` lines below for a few days, and raise it if many of them were skipped
for load.

### Why a worker did not start - the `KICK` lines in `runner.log`

Every immediate-dispatch decision leaves one line in `<root>/workers/runner.log`.

```
<date> <time> [dispatch] KICK <reason> <hash or -> <worker>
<date> <time> [dispatch] KICK-SKIP <reason> <hash or -> <why it did not start>
```

- **A `KICK` line** means that worker was started. A `-` in the hash slot means it started without
  a hash, so the worker takes the ticket at the head of the queue. Whether it actually took a
  ticket shows in that worker's `DISPATCH` line.
- **A `KICK-SKIP` line** means nothing started, and the last field says in a sentence which
  condition failed: load over the limit, no idle worker, another candidate waiting, or the ticket
  not being a candidate.
- **The `cron` reason writes no line at all.** It would pile up a line every 30 seconds. For cron
  rounds, read the worker-named `DISPATCH` and `SKIP` lines as before (see [Logs](/docs/logs)).

If you made a request ticket, nothing started for more than 30 seconds, and there is no
`KICK-SKIP` line either, immediate dispatch was never called. Look at cron instead.

To see the decision without starting anything, call it yourself with `--dryrun`. The engine
directory is the one that holds `tick.sh`.

```
python3 <engine>/dispatch.py run <root> --reason request --hash <hash> --dryrun
```

The result is one line of JSON. `go` is `true` if it would start a worker; if `false`, the reason is
in `why`. `--dryrun` starts no worker, writes no log, and does not change a single character of the
queue.

### Starting one now - MCP `dispatch_now`

To start a worker now from an MCP client, call `dispatch_now`. Both arguments are optional.

| Argument | Given | Omitted |
|---|---|---|
| `hash` | Starts a worker on that ticket. The ticket has to be a candidate | The worker takes the ticket at the head of the queue |
| `worker` | Only that worker is considered | The first idle worker by name is picked |

The reason is `direct`, so load and other candidates are not checked. The response is the same JSON
as `--dryrun` above; if nothing started, read `why`. The older `dispatch` tool requires a worker
name, runs that worker once, and does not look for an idle worker.

When you make a request ticket through MCP `ticket_create`, the `request` reason is called along
with it, and its decision JSON comes back under the `dispatch` key of the response.

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
