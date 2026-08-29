# Reading the logs

A log is the file where a worker and a session write down what they did, one line at a time, each
with a time. There are three of them, and which one you open depends on what you want to know.

```
<root>/workers/runner.log                        the dispatch record
<root>/workers/logs/<time>-<worker>-<hash>.log   the actual output of one session
<root>/workers/cron.log                          cron's own redirect
```

## `runner.log` - the dispatch record

This is where a worker leaves what it did on each tick. The format is
`<time> [<worker name>] <message>`, and the message is sorted by its prefix.

| Prefix | When | What it means |
|---|---|---|
| `DISPATCH` | the moment it claimed a ticket and opened a session | writes `kind`, `persona`, `sid` and the session log filename, along with the effective priority (`prio=`) |
| `DONE` | the session ended normally | writes the real `session_id`. A session that finished the `.done` rename and then died gets this word too, and in that case `(세션은 rc=n로 죽었다)` - the session died with rc=n - is attached at the tail |
| `FAIL` | the session ended on an error | rc was not 0, or the response carried `is_error` |
| `TIMEOUT` | killed for going over `TICKET_MAXRUN` | rc is 143 or 137 and the elapsed time is over the cap |
| `KILLED` | cut off from outside by a signal before the cap | rc is the same 143 or 137 but the elapsed time is under the cap. This is the line a forced unassign produces |
| `STALL` | the engine never received the first prompt | over `TICKET_FEED_TIMEOUT` |
| `NOTE` | a notice that stops nothing | a session key correction (the real `session_id` differs from the one issued in advance), an engine cooldown starting, a cooldown lifted because the token changed |
| `SKIP` | this tick was skipped | the same worker is still holding the previous session, another worker is in the middle of selecting, a persona or engine cap was hit, an engine cooldown has time left, or a headless `claude` candidate has no authentication token (`SKIP AUTH 대기 ...` is left only the first time) |
| `WARN` | something wrong that stops nothing | a stale lock reclaimed, a context path missing, a persona profile missing, and the like |
| `ERROR` | a failure while preparing the dispatch | one of four spots - `select` failed, `assign` failed, the working directory (`TICKET_CWD`) is missing, `mkfifo` failed |
| `REAP` / `REAP-FAIL` | a stale ticket reclaimed into the backlog (or the reclaim failed) | at the head of every tick |
| `ASK` / `ASK-FAIL` | turned into a request for an answer (or the lock failed) | on the third automatic reclaim, or at once whatever the count if the session stopped leaving a `## 블록` (the block section). A `## 질문 n` (the question section) is attached to the body. The one branch that leaves no such line is a ticket locked by the handoff cap (below) |
| `SUSPECT` | a hand-claimed session is suspected idle (reported only) | it is not reclaimed automatically |
| `UNASSIGN` / `UNASSIGN-FORCE` / `UNASSIGN-DENY` | unassigned, unassigned by cutting a live session off, refused because the session is live | from the `unassign` command. The middle one comes from `--force` |

This is the first place to check "it looks like nothing is happening." If no `DISPATCH` was
printed, the dispatch itself did not happen (selection failed, waiting on authentication, and so
on), and if there is a `DISPATCH` with neither `DONE` nor `FAIL` after it, the session is still
running.

One branch leaves no line in this file at all. A ticket that has been handed off more than three
times is put straight back down the moment a worker claims it and locked into Awaiting answer,
and because that call is made inside the claim command, neither `ASK` nor `SKIP` is printed. The
trace is on the ticket instead. A `## 질문 n` is attached to the body and the board card gets the
`Awaiting answer` badge. When the log is quiet and a ticket is not going out, start from that
badge ([The states a ticket passes through](/docs/states)).

## `logs/<time>-<worker>-<hash>.log` - the actual output of one session

If `runner.log` is "when did it take which ticket," this file is "what happened inside that
session." The engine's standard error and final standard output pile up here. On the default
engine (`claude -p` with streaming input) one JSONL line is one event, and the last
`"type":"result"` line is that session's final verdict - the ground for the `FAIL` or `DONE`
call.

When a `FAIL` or a `TIMEOUT` is printed in `runner.log`, why it failed shows up only in this
file. `runner.log` records the verdict alone; what the session actually read, and what it was
attempting when it got stuck, is held here.

While it runs, the file is usually empty. The worker collects the engine output separately and
pours it in at once after the session ends. To watch a session in progress live, open the session
stream on the ticket page. What that screen reads is not this file but the transcript, the record
where Claude Code writes down, in order, what its session said and which tools it called ([The
screens](/docs/screens) §The session stream).

## `cron.log` - the output of the worker script itself

This is what the crontab line redirects into (`>> .../cron.log 2>&1`). What piles up here is the
standard output and standard error of the worker **shell script itself**, not the output of a
session. In normal operation it is usually empty, because everything `tick.sh` does gets written
into `runner.log` separately. If there is anything in this file, either `bash` itself could not
run (permissions, a broken shebang) or `tick.sh` died before it even started.

There is one exception. `WARN 구 레이아웃에 티켓 n건이 남아 있다` - n tickets are left over in
the old layout - is printed to standard error by the queue check, and it comes here as well. No
amount of digging through `runner.log` turns it up, so when a ticket has vanished from the board,
look in this file too ([Troubleshooting](/docs/troubleshooting) §A ticket is not on the board).

## What to check, by symptom

1. **It looks like nothing happened** -> start with `runner.log`. Look for a `DISPATCH`, and if
   there is one, whether `DONE`, `FAIL` or `TIMEOUT` followed it.
2. **Even `runner.log` is not being updated** -> look at `cron.log`. The worker itself never came
   up (for mount trouble see [Troubleshooting](/docs/troubleshooting) §No worker appears at all).
3. **A `FAIL` or `TIMEOUT` is printed and you need the reason** -> open the per-session log under
   `logs/` using the `로그 <파일명>` - log `<filename>` - at the tail of that line. The same
   filename is written on that ticket's `DISPATCH` line as `log=`.

Next is [Usage analytics, and how to turn them off](/docs/analytics).
