# Running the engine alone

**If you use the app, you can skip this chapter.** It is an appendix. Add one worker on the
workers screen and the app writes the worker file and registers it on crontab for you. The main
line is [Workers](/docs/worker).

From here on is the case where you took the engine alone with `git clone` and no `.dmg`
([Install](/docs/install), §Running the engine without the app). There is no screen, so the worker
file and the crontab entry are both written by hand. You read the results in a shell.

## 1. Making one worker file

One file is all it takes to attach dira to a project. The only line it must have is the one that
sources `tick.sh`. **Where this file sits is the queue root.** With `<root>/workers/w1.sh`, the
parent of `workers` is the root, which is why no setting anywhere holds a root path.

```bash
mkdir -p ~/Projects/myproject/.dira/workers
cat > ~/Projects/myproject/.dira/workers/w1.sh <<'EOF'
#!/bin/bash
. "$HOME/Projects/dira/tick.sh"
EOF
chmod +x ~/Projects/myproject/.dira/workers/w1.sh
```

You never run `tick.sh` itself. Try it and it refuses with rc=2, because without knowing where the
worker file sits it cannot know the root either. The entry point is always the worker file. The
engine repo's `worker.sh.example` is a sample with every value you can set written out as
comments. You can copy that instead of the two lines above.

```
<root>/
  tickets/<hash>.md          <- the queue. flat
  personas/<name>/PROFILE.md
  protocols/AGENTS.md
  ontology/                  <- if present, the prompt just says where it is. optional
  workers/w1.sh w2.sh        <- workers. how many files are here is your concurrency
  workers/runner.log logs/   <- dispatch record - per-session output
```

If you want a starting point for personas and protocols, copy the templates. It runs without them
too. A plain agent with no persona handles the tickets.

```bash
cp -r ~/Projects/dira/templates/* ~/Projects/myproject/.dira/
```

## 2. Keeping the queue outside the project - `TICKET_CWD`

Nothing says the root has to live inside the project. If several people work off one queue, put
`workers/` on a mounted shared drive (Google Drive or the like) and point cron at that path.

A session starts in the parent of the root by default (if `<project>/.dira` is the root, that is
`<project>`). Put the queue outside the project and that default stops meaning anything. Name the
working directory yourself with `TICKET_CWD`.

```bash
mkdir -p "/Volumes/TeamShare/myteam/.dira/workers"
cat > "/Volumes/TeamShare/myteam/.dira/workers/w1.sh" <<'EOF'
#!/bin/bash
TICKET_CWD="$HOME/Projects/myproject"
. "$HOME/Projects/dira/tick.sh"
EOF
chmod +x "/Volumes/TeamShare/myteam/.dira/workers/w1.sh"
```

When the mount is not attached, the worker file itself is not there. cron calls that path, finds
no script to run, and fails quietly without leaving a single log line. It is not sitting still
because the queue is empty; it is sitting still because the file is gone. Do not write it off as
"nothing to do" - check that the worker file is actually visible first, with
`ls "/Volumes/TeamShare/myteam/.dira/workers"`.

## 3. Changing the engine - `TICKET_ENGINE`

The default engine is `claude -p`. A worker is the place that calls engine code which knows
nothing about your project (`tick.sh`), so switching to a different CLI agent is also one line in
this file.

```bash
#!/bin/bash
TICKET_ENGINE=(codex exec --json "{prompt}")
. "$HOME/Projects/dira/tick.sh"
```

The prompt assembled just before the run goes where `{prompt}` is. Correcting the frontmatter with
the real `session_id` from the response JSON is a `claude`-only step, so another engine simply
skips it. Every value you can set is in
[Worker environment variables](/docs/ref-env).

## 4. One run by hand before you put it on cron

Start with cron and your first failure gets tangled up with an authentication problem, which
muddies the cause. Watch one round trip in a shell first.

`dryrun` runs nothing and prints only what it picked and the prompt it assembled. Before a session
ever starts, you can see with your own eyes whether the worker really picks that ticket and what
the prompt gets filled with.

```bash
~/Projects/myproject/.dira/workers/w1.sh dryrun
```

Call it with no argument and it is a real single dispatch. The worker takes a ticket, starts a
session, and waits for that session to finish.

```bash
~/Projects/myproject/.dira/workers/w1.sh
```

`list` prints the state of the open queue (open, assigned, blocked). If a ticket has disappeared
from the queue, the session that just ran took it and finished it.

```bash
~/Projects/myproject/.dira/workers/w1.sh list
```

`dryrun` and `list` look at the whole queue, so any worker file under the same root gives the same
answer. Dispatch with no argument is different. It is the side that actually takes a ticket, so
the name of the worker you called is written into that ticket's `owner`
(see [CLI](/docs/ref-cli)).

## 5. Two crontab lines

Everything so far assumed a person sitting there calling it by hand. To have it run by itself
every minute, register it with cron. cron cannot reach the login keychain, so from this point on
you need a long-lived token ([Authentication](/docs/auth), §Without the app - using the engine
alone), and if the queue root is a cloud mount you need Full Disk Access as well.

```
* * * * * $HOME/Projects/myproject/.dira/workers/w1.sh >> $HOME/Projects/myproject/.dira/workers/cron.log 2>&1
* * * * * sleep 30; $HOME/Projects/myproject/.dira/workers/w1.sh >> $HOME/Projects/myproject/.dira/workers/cron.log 2>&1
```

Put those two lines in with `crontab -e`. **Two cron lines per worker.**

### Why two lines

The finest unit cron can produce is a minute (`man 5 crontab`). To look at the queue every 30
seconds you need one line at :00 and one at :30. The second line pulls itself forward 30 seconds
with `sleep 30` and then calls the same worker.

### Why you cannot join them with `;` on one line

A worker is a synchronous process. The shell only moves on to `sleep 30` once `w1.sh` has
finished. Join them on one line and the back half waits for the front session.

```
# do not do this
* * * * * w1.sh; sleep 30; w1.sh
```

If the first call took a ticket that turns into a 30-minute session, the back half runs 30 minutes
later, not 30 seconds later. Your 30-second polling has quietly become sequential execution. Split
it into two lines and cron's scheduler starts each line as its own process, one at :00 and one at
:30. If the earlier run has not finished within the same minute, the worker lock makes the later
one `SKIP`, so two runs never take the same ticket at once.

## Stopping

Delete those two lines from the crontab. You do not have to delete the worker file. It gets used
as it is when you register again.

## Logs

- `<root>/workers/runner.log` - how a dispatch went (selection, claim, `SKIP`, and so on)
- `<root>/workers/logs/<time>-<worker>-<hash>.log` - the actual output of one session

The `cron.log` those crontab lines redirect into is the worker script's own stdout and stderr.
While things work it is mostly empty, and something lands there only when the shell itself broke.
For what actually happened to a ticket, read `runner.log` and `logs/`
([Reading the logs](/docs/logs)).

If it looks like nothing is running, see [Troubleshooting](/docs/troubleshooting). That chapter
points at a place on screen first, but the shell command for checking each symptom works the same
with no screen at all.

Next is [Worker environment variables](/docs/ref-env).
