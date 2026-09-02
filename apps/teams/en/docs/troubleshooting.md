# Troubleshooting

This chapter goes from the symptom down to the cause. Someone who is stuck arrives holding
"nothing is happening," not "the headless token expired."

**Whatever the symptom, the place to look first is the screen.** The app has already made the
call and drawn it, and there is no reason to dig the same thing back out of a terminal. You open
the logs at the point where the screen stops answering. A log is the file where a worker and a
session write down what they did, one line at a time, each with a time.

The commands in the grey boxes below are checks the app does not run for you, so type them into a
terminal yourself. `<root>` in them is the queue root, that is, the `.dira` inside the project
folder.

## A ticket is not on the board

**Screen**: clear every filter and the search box on the board, and look in the table view
(`?view=table`) as well. The Done lane draws 20 to begin with. Another 20 attach when you reach
the bottom, so an old done ticket only appears once you have scrolled all the way. If it is still
nowhere, open the **notification bell**. An `Assigned` ticket sits in no lane and shows up there.

**Cause**: if it is in neither place, the file did not pass the queue's check. It is one of three
things.

- **It is not directly under `tickets/`.** The queue is flat and does not look inside
  subdirectories. In this case the check prints `WARN 구 레이아웃에 티켓 n건이 남아 있다` - n
  tickets are left over in the old layout.
- **The filename does not end in `.md`, or it starts with `.`.**
- **It already carries a `.wip` or `.done` suffix.** That is not an open ticket ([The states a
  ticket passes through](/docs/states)).

```bash
ls <root>/tickets/                           # flat? named <hash>.md?
<root>/workers/w1.sh list                    # what the engine actually reads as an open ticket
```

If it is in `ls` but not in `list`, the check dropped it. That `WARN` line goes to standard error
rather than to `runner.log`. Run `list` by hand and it prints straight to the terminal; the one
cron runs piles up in `cron.log` ([Reading the logs](/docs/logs) §`cron.log`).

## It is Open and nobody claims it

**Screen**: look for an orange **`deps` tag** on the card. If it is there, a prerequisite ticket
has not finished yet, and the tag disappears on its own once the prerequisite is done. If the
card carries the **`Polling` badge**, that ticket is waiting on a condition outside, which is the
next section. If it has neither, open the notification bell. `Tickets waiting on an answer:` and
`Tickets no one will claim:` each report their own count there.

**The cause** differs by bell item.

- **Awaiting answer** - the session got blocked, attached a `## 질문 n` (the question section)
  and locked itself. A hash that does not exist is set as its `deps`, so no worker will claim it
  until a person writes an answer. There are two places to write one: the input box at the end of
  the Progress record on the ticket page, and the `Post answer` button on the board card. It is
  the same form, so either way lands in the same place. A ticket also arrives here by dying over
  and over. Automatic reclaim goes twice, and from the third time it turns into a request for an
  answer (if the session left a `## 블록` (the block section), it turns over at once whatever the
  count).
- **Tickets no one will claim (`Assigned`)** - an open file with `session_id` filled in. The
  engine never produces that combination. A ticket in this state is permanently out of selection
  and dies quietly. The **`Unassign`** button on that line inside the bell clears it.

```bash
<root>/workers/w1.sh list                       # Blocked and Assigned print just as they are
tail -20 <root>/workers/runner.log | grep ASK   # when it turned into a request for an answer
```

## It says `Polling` and the condition never arrives

**Screen**: the one line under the badge on the card answers first. It is the sentence the
session left about what it is waiting for and why. Then open that ticket and read the
**`Polling` section** in the right-hand column, right below the `frontmatter` table. The same
sentence is in the `Reason` row, and below it: what it is waiting for (the script body), how often
it runs (the interval), how long it waits (the deadline and the time left), when it last ran, and
the **last output**. The reason it is stuck is usually written in that last output.

**The cause** splits as you read that section from top to bottom.

- **There is no `Reason` row.** The session that hung the wait did not write a reason in the
  first line of `## 결과` (the result section). The screen does not invent one, so the row is
  simply absent. Read what it is waiting for from the script body below.
- **`Last polled` reads `Not run yet`.** No worker has woken since the wait was set. This is not
  a polling problem. Read the next section (§The whole queue is stopped), then §It is on cron but
  never wakes.
- **The last polled time keeps moving but the condition never comes.** The script is running
  fine and the thing outside has not finished. This is normal. Leave it until the deadline.
- **There is an error message in the last output.** The script side is broken. Three of those in
  a row and the engine gives up polling and moves the ticket to Awaiting answer.
- **`Script file not found` is showing.** The file has gone from under `polls/`. This ticket has
  no way to judge its condition and will not come loose until the deadline.

```bash
cat <root>/polls/<hash>.log                    # the source of the output the ticket page shows (last 200 lines)
bash <root>/polls/<filename>; echo $?          # run it once by hand. 0=condition met, 1=not yet, anything else=an error
```

If it gives `0` by hand and the card still reads `Polling`, the script is fine. Check whether
workers are waking at all.

**There are three ways to cut it short.** The first two are the handles at the bottom of the
`Polling` section, and you can press them well before the deadline.

- **`Dispatch now`** - puts the ticket back in the candidate pool with its condition unmet. It
  wakes a worker on the spot rather than waiting for the next tick, so it gets claimed right away.
  There is no confirmation dialog.
- **`Extend deadline`** - writes the time in the field beside it as the new deadline. Use it when
  the condition looks close but the deadline is closer. The time left on the card follows the new
  value.

The third is to leave it alone. Once the deadline passes the badge turns into `Deadline passed`
and at the next tick the engine escalates that ticket to Awaiting answer. The question that comes
up then quotes the last polling output, and you choose between extending the deadline to wait
longer, dispatching now regardless of the condition, and closing it outright. That screen is like
any other question, and it is a different place from the two handles above.

The handles do not make an answer file. Nobody asked a question, so there is no answer to write.
What changes in the ticket file is only this: `Dispatch now` empties `polling` and
`polling_fails`, and `Extend deadline` rewrites `polling_until`
(see [frontmatter fields](/docs/ref-frontmatter)).

## The whole queue is stopped

**Screen**: the `Uncommitted changes are blocking dispatch` item in the notification bell. It is
not that a few tickets are caught. Every worker in this project does wake each minute, and none
of them takes a ticket. Open piles up on the board and the worker screen is all `idle`, so
nothing is red anywhere until you open the bell.

The item names the absolute path of the receiving tree first, and under it lays out the lines
`git status` printed, verbatim. The first two characters are the status code and the rest is the
path. It lays out every one of them however many there are - it does not cut the list down to the
first few. The receiving tree is the original the workers' worktrees branched off from, that is,
the project folder itself.

**Cause**: a session works in its own worktree and pushes to the receiving tree when it finishes.
If uncommitted changes are left in that tree, git refuses that push outright
(`receive.denyCurrentBranch=updateInstead`). The session then burns its five to twenty-five
minutes and dies only at the final push. The ticket is reclaimed, goes to the next worker, and
gets stuck at the same spot again. The dispatch gate heads that waste off. A worker measures the
receiving tree before it picks a ticket and ends the tick right there if the tree is dirty.

What it measures is narrow. It blocks only while the receiving tree **has the integration branch
checked out**. If the tree is on another branch, or on a detached HEAD from a rebase, dispatch
goes ahead even when it is dirty, because that push was going to pass anyway. Untracked files are
not counted either. One scratch file does not get to stop the queue.

There is one gate per project. A project you create now comes with it from the start, and on a
project made before that, the worker screen points it out with `This worker dispatches even when
the receiving tree is dirty` and attaches an `Apply dispatch gate` button. A project with no gate
gets no notification either. Its sessions die at push instead, one after another.

**There is one thing to do - commit in that tree, or delete the changes if you meant to discard
them.** If it is something you were half-way through editing, commit it; if it is debris a
competing push left behind, delete it. The lines laid out in the bell are what you make that call
from.

**The app has no button.** Whether to commit or to delete differs line by line, and it is a call
a person makes with the file in front of them. If the screen picked one of the two and put it on
a button, the app would be committing or deleting inside somebody else's working tree for them.
Showing the lines as they are is where this item stops.

**There is no procedure for clearing it.** Once the tree is clean, a worker simply picks up again
at the next tick. The bell item drops off by itself at the next check five seconds later. There
is no release button to press, and no flag stays behind to keep blocking a tree that is fine.

```bash
git -C <receiving tree> status --porcelain -uno   # the lines the bell lays out
grep GATE <root>/workers/cron.log | tail -4       # the hold and the release, one line each
```

`GATE 디스패치 보류` (dispatch held) and `GATE 해제` (gate released) stay as a pair. What lies
between them is the stretch the queue sat stopped. These two lines are in `cron.log`, not
`runner.log` ([Reading the logs](/docs/logs) §`cron.log`).

### With the desktop app, an OS notification comes too

If you use `dira.app`, you find out without watching the window. The title says dispatch is on
hold, and the body carries the project name and the number of uncommitted changes. Press it and
the window opens on that project's board.

**It comes once, the moment it blocks.** It does not come again while it stays blocked. An hour
later, a day later, that one time is all there is. Inside the app the bell item is up the whole
while, and that is enough. Nothing comes when it clears, either. A person cleared it by
committing with their own hands, so there is nothing to announce.

If it was already blocked before you opened the app, that project passes without a notification.
The first check after launch only writes down quietly what is blocked right now. If a backlog of
notifications poured out every time you opened the app, people would turn the notifications off.
The bell still shows it in this case.

### What this notification does not have

- No switch to turn it off. That goes for the bell item and the OS notification alike.
- No resend. A day spent blocked does not make it shout any louder.
- **Another project being blocked does not appear here.** The bell watches only its own project.
  That hold is up in that project's bell. The place that goes through every registered project is
  the OS notification.

## Workers run but nothing gets done

**Screen**: look at the **settings button** at the top right of the header. When there is no
authentication, `Needs auth` attaches to the button itself. The `No Claude token` item
in the notification bell says the same thing, and the link inside that item opens settings
directly. Pick `Authentication` › `claude` in the left-hand tree and you can issue one right
there ([Authentication](/docs/auth)).

**Cause**: the headless token is missing or expired. When the engine is `claude` and the run is
non-interactive (cron) with no `oauth-token`, the worker skips every candidate on that engine
(`SKIP`) and logs it only the first time (a `.authwarn` file keeps the log from repeating). Any
candidate on an engine other than `claude` dispatches as usual. It is the `claude` candidates
alone that starve. If the token is there but has expired, dispatch does happen and the session
ends immediately on an authentication error, leaving a `FAIL`.

If authentication is fine and you still see this, look at the machine-wide session limit. With
this computer at the limit, or this project having spent its whole share, the workers do wake up
but claim no ticket. How to tell is in [How many to run at once](/docs/concurrency)
§Telling whether the limit is what is starving you.

```bash
ls -la ~/.config/dira/oauth-token             # is the file there, and when was it made
grep 'AUTH 대기' <root>/workers/runner.log    # SKIP AUTH 대기 ... the line left only the first time
```

If a `FAIL` is printed, the reason is in that line's session log ([Reading the
logs](/docs/logs) §`logs/`).

## Sessions die the moment they open

**Screen**: the `Workers that die the moment a session opens:` item in the notification bell.
This is the case where the queue and the workers are both fine and only the session dies - a
limit run down, an overloaded API, a dropped connection. When the reason carries a recovery time,
it is shown as it is (a line like `session limit · resets 7:40pm`).

**Cause**: outside the app. What you do here is wait, or raise the limit; it is not fixing the
queue. Meanwhile the workers go back and forth between `idle` and `running` and the ticket sits
in Open, so everywhere else on the screen looks perfectly normal. That is exactly why this item
stands on its own.

Once a session dies this way, the worker does not run straight back into it. It puts a cooldown
on that engine and turns the next few ticks away at the door. The default is 300 seconds, or up
to the recovery time if the limit message gave one. During that, all `runner.log` collects is
`SKIP 엔진 쿨다운 · n초 남음` - engine cooldown, n seconds left. It looks like nothing is
happening, and that is what it should look like.

**This notification does not go out by itself.** It stays in the bell after the workers are back
to normal. If they died like this through the night, it has to be there in the morning too, so
that whoever was away sees it happened. The worker screen works differently: the failure lines
that attach there are cleared after ten minutes.

Once you have read it, press `Archive` at the bottom right of the item. Every failure listed at
that moment is archived at once and the item folds away. It moves rather than deletes, so turning
on the `Archived` toggle at the head of the popover shows the time, the worker and the reason
exactly as they were. Of the eight items the bell shows, only this one and `Stretches the queue
sat stopped: 3` carry this button, and one press clears either item entirely. Three nights on,
`Archive` is still one press. The archive, on the other hand, keeps one row per event - which
night it stopped and how many times is right there ([The screens](/docs/screens) §The
notification bell).

Archiving does not bury it until the next incident. The unit is one failure rather than one
worker, so a new `FAIL` is a different failure and the item comes back.

```bash
grep -E 'FAIL|TIMEOUT' <root>/workers/runner.log | tail -5
```

The log filename at the tail of a `FAIL` line is where the reason came from. The `result` in the
last line of that JSON is the wording you saw ([Reading the logs](/docs/logs) §`logs/`).

## A worker is `stale`

**Screen**: the state column on the worker screen. Each row shows its pid beside it.

**Cause**: this is not always a malfunction. Reclaiming (`reap`) is the move that puts a ticket a
dead session was holding back into the open state, and what it decides on is process liveness
rather than elapsed time. A healthy session that takes a long time and a hung one cannot be told
apart by time taken alone. If the pid is alive the worker is `running` and is left alone however
long it takes; if it is dead the worker is `stale`, and the next tick reclaims the ticket (there
is a three-minute grace right after dispatch). A `stale` you happen to catch usually clears
itself within 30 seconds.

```bash
<root>/workers/w1.sh reap                                 # force a round right now
tail -20 <root>/workers/runner.log | grep -E 'REAP|SKIP'
```

If `REAP` is printed it was reclaimed, and if nothing is printed the session is still alive. In
that case you wait ([Reading the logs](/docs/logs) §`runner.log`).

## It is on cron but never wakes

**Screen**: `stopped` in the state column of the worker screen means crontab has no line for that
worker (only the file exists). `idle` means it is registered.

**Cause**: every time you register a worker from the app, macOS asks again for the **`App
Management`** permission. It does so because the app is writing a line into crontab. This is
separate from Full Disk Access. The approval does not carry over to the next registration.
Registration itself is stopped until you answer, so missing the dialog looks like "I made it and
it does not run" ([Authentication](/docs/auth) §`App Management`).

```bash
crontab -l | grep <worker name>     # are that worker's two lines actually registered
```

If they are not there, approve it in `System Settings › Privacy & Security › App Management` and
make the worker again. The procedure for hooking it up by hand is in [Running the engine
alone](/docs/cron) §The two crontab lines. If it is registered and the log still does not grow at
all, that is the next section ([Reading the logs](/docs/logs) §`cron.log`).

## No worker appears at all

**Screen**: that project reads `Disconnected` in the project list, or the row that should be on
the worker screen is missing entirely. It means the app cannot read that path either, so this is
a problem with the path rather than with the queue.

**Cause**: the queue root is on a cloud mount (Google Drive and the like) and the mount is not
attached. The worker files themselves are inside that mount, so when it drops off there is no
script to run at the path cron hits. It fails quietly with no error, which makes this an easy
spot to misread as "the queue is empty, that is why nothing runs" ([Running the engine
alone](/docs/cron) §Putting the queue outside the project).

```bash
ls <root>/workers/     # start by checking whether the worker files are visible at all
```

If they are not, look at the mount first. If the mount is attached and the rows are there but
`runner.log` does not grow, the shebang or the execute bit is broken, and that is left only in
`cron.log` ([Reading the logs](/docs/logs) §`cron.log`).

## A common worker you made earlier is still there

**Screen**: the worker table has a row this project never made. The name looks like `pw1` and the
status is `stopped`. Open `Settings` › `Workers` and there is no place that made that worker.

**Cause**: there used to be a feature where you made workers once on the machine and each project
decided how many of them to borrow. That feature has been taken out, so there is no place left to
make them and none to borrow them. The code that deleted them went out with it, so updating the
app leaves whatever you made earlier sitting on this computer. Three places hold what is left, and
the order matters.

**Take the lines out of crontab first.** Each slot has two lines on it, so it is still waking up
every 30 seconds. Delete the files first and cron will run a file that is not there for the next
minute, piling errors into the log.

```bash
crontab -l | grep 'dira/pool'                  # see how many lines are on it first
crontab -l | grep -v 'dira/pool' | crontab -   # drops those lines and keeps the rest as-is
```

The second command rewrites the whole crontab. Your worker lines and comments do not contain
`dira/pool`, so they stay, but it is safer to run the first command and see which lines are going
before you run it.

**Then delete the pool on this computer.** The script those cron lines were calling, its log, and
the lock the slots used are all here.

```bash
rm -rf ~/.config/dira/pool
rm -rf ~/.config/dira/run/pool-*.lock
rm -f ~/.config/dira/run/pool-turn-*
```

**Last, clear two files out of each queue.** A queue that borrowed has one worker file and one
borrow-limit file in it. You do not have to remember which projects were borrowing; walk your
registered projects once. The paths are in the `Path` column of the project list.

```bash
grep -l 'dira-pool:' <root>/workers/*.sh   # the worker file that came in; none means this queue never borrowed
rm -f <root>/pool-limit                    # the borrow limit. The app has no place that reads this value
```

**You can keep the worker file and just use it.** Its shape is the same as a worker this project
made, so pressing `Re-register` on that row runs it as a worker of this project. To change the
name, delete the row with `Delete` and make it again with `New worker`. Both of those are done
from the table, so no shell is needed.

Next is [Reading the logs](/docs/logs).
