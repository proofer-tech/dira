# CLI

Two layers. The worker script is the entry point a person calls, and `tickets.py` is a helper that
the worker script usually calls from inside.

## The worker script (`<root>/workers/<name>.sh`)

Run `tick.sh` directly and it refuses with rc=2. Without knowing where the worker file is, it
cannot know the root either. Every command below goes through that worker file.

| Command | What it does |
|---|---|
| (no argument) | One dispatch. The cron entry point - take the worker lock → `reap` → select → run |
| `list` | The state of the open ticket queue (open, assigned, blocked) |
| `dryrun` | No claim and no run: prints only what it selected and the prompt it assembled |
| `reap` | One pass of reclaiming stale tickets, and nothing else |
| `unassign <hash> [--force]` | Unassign (clear `session_id` and drop the in-progress suffix) → back to the queue |

`list`, `dryrun`, `reap`, and `unassign` all look at the whole queue, so any worker file under the
same root gives the same answer.

`unassign` refuses and ends with rc=3 if the session is still alive. Unassigning while the session
runs reopens the ticket, and two workers end up on the same one. Unassigning yourself is the
exception - if the session making the call owns that ticket, it goes through.

`--force` cuts that session's `pid`. It locks the ticket into awaiting answer **before** cutting,
so the freed ticket does not go back to the backlog. It shows up where it waits for a person's
answer. If the ticket has no `pid`, forcing gets you nowhere. There is nothing to cut, so you have
to end that session yourself.

## `tickets.py` subcommands

A helper for handling the queue and frontmatter. Most of them the worker script above calls from
inside, and the ones a person uses directly are about `handclaim` and `find`.

| Command | Arguments | What it does | Who uses it |
|---|---|---|---|
| `handclaim` | `<ticket path> ["<owner>"]` | An interactive session takes a ticket by hand. `claim`, plus writing `pid`, `claimed_at`, and `transcript` (for the liveness check) | **A person** (an interactive session) |
| `find` | `<root> <hash>` | Finds a ticket's path by hash | A person (checking a hash exists before writing it into `deps`, say) or the engine |
| `select` | `<root>` | Prints unassigned open tickets, highest effective priority first, as `path\|hash\|kind\|persona\|priority\|baseline\|effective` lines. Ties go by creation date, oldest first | The engine (`tick.sh` picking candidates) |
| `wips` | `<root>` | Prints the tickets in progress right now as `path\|hash\|effective priority\|assigned_at\|pid\|owner` lines. The other side of `select` - who is running | The engine (picking a victim to preempt) |
| `list` | `<root>` | The full state table of open tickets | The engine (the worker's `list` hands straight over to it) |
| `claim` | `<path>` | The atomic take, `<hash>.md` → `<hash><in-progress suffix>.md` | The engine |
| `release` | `<path>` | In progress back to the original name (back to the backlog) | The engine |
| `assign` | `<path> <sid> ["<owner>"]` | Writes `session_id` and `assigned_at` (and `owner`) into the frontmatter. `pid` is cleared at the same time | The engine |
| `setpid` | `<path> <pid>` | Writes `pid` into the frontmatter | The engine |
| `setinbox` | `<path> <inbox path>` | Writes `inbox` (the path of the interject FIFO) into the frontmatter | The engine |
| `askhuman` | `<path> [--if-blocked]` | Locks the ticket into awaiting answer - appends a `## 질문 n` (the question section) to the body and puts one hash that does not exist into `deps` and `awaiting`. With `--if-blocked` it only does so when the last section is a fresh `## 블록` (the block section) | The engine (both branches of `unassign`) |
| `clear` | `<path>` | Clears `session_id`, `assigned_at`, `pid`, and `inbox` | The engine (`unassign`, and the failed-dispatch path) |
| `reap` | `<root>` | Reclaims in-progress tickets whose session died, back to the backlog | The engine (first thing every tick) |

`select` can be called as it is when you are scripting something together, the same way `find` can.
That said, the places a person touches the queue day to day are covered by the worker script's
`list`, `dryrun`, and `unassign`, plus `handclaim`.

## `dira env` - using project environment variables from a session

> As of 2026-10-10 the commands in this section and the session start notice are still being built.
> If running `dira env list` in a session fails with a command-not-found error, this section cannot
> be followed yet. The state of the settings panel is at the top of the `Project environment
> variables` section of [Screens](/docs/screens).

These commands let a session use the values left in `Environment variables` in settings. How to use
the screen and what is protected are in the `Project environment variables` section of
[Screens](/docs/screens). The commands work on the same values, and they need the dira desktop app
to be running.

Worker sessions and project home sessions are told, when they start, the variable names registered
for the project and the commands below. They do not receive values or revisions. That list of names
is as of session start, so if someone may have changed it since, read it again with `dira env list`.
A home session opened without a project gets no such notice.

| Command | Meaning |
|---|---|
| `dira env list` | Prints name, updated time, and revision. Never prints values |
| `dira env create NAME --stdin` | Registers the value read from stdin under a new name. Refuses a name that already exists |
| `dira env replace NAME --revision REV --stdin` | Replaces the value. Ends in a conflict if REV is not the current revision |
| `dira env delete NAME --revision REV` | Deletes it. REV is checked the same way as `replace` |
| `dira env run --keys NAME1,NAME2 -- COMMAND ARGS...` | Runs COMMAND with only the chosen names in its environment |

Values are read from stdin only. No option takes a value as a command argument, and no command
prints a value. Registering looks like this.

```sh
# register a value copied to the clipboard; the value never appears on the command line
pbpaste | dira env create TEST_API_TOKEN --stdin

# read the revision from list, then replace with a new value
dira env list
pbpaste | dira env replace TEST_API_TOKEN --revision <revision from list> --stdin
```

Do not write a value into `echo` or `printf` and pipe it. The value becomes a command argument and
stays in shell history. When a session needs a value only a person has, it should not ask for the
value in the chat; it asks the person to enter it on the settings screen. Once a value has gone into
a chat or a tool call record, dira does not erase it from that record.

If `replace` or `delete` ends in a conflict, another session changed it first. Read the new
revision with `dira env list` and run it again. When two sessions replace with the same revision at
the same time, only one succeeds.

### `run` - running with only the chosen variables

```sh
dira env run --keys TEST_API_TOKEN,TEST_DB_URL -- python3 scripts/smoke.py --target staging
```

- Only the names listed in `--keys` go in. A registered name you did not list is not passed.
- If any listed name is missing, COMMAND is not started at all. Deleted names and names that cannot
  be registered fail here.
- If the shell already has a variable of the same name, the registered value wins. The environment
  of the shell that called `run` does not change.
- COMMAND is run with its arguments as written, without a shell. If you need a pipe or an expansion
  such as `$TEST_API_TOKEN`, call a shell yourself, as in `-- sh -c '...'`.
- The exit code is COMMAND's own, and cancel signals such as Ctrl-C are passed to COMMAND.
- In COMMAND's stdout and stderr and in the progress log, any string identical to an injected value
  is masked, even across lines or when the output arrives in pieces. A transformed value is not
  masked.
- Values are read fresh on every run. A replace or delete on the screen applies from the next `run`;
  a COMMAND already running keeps the old value.

If the desktop app is closed or the connection drops, every `dira env` command ends with
`unavailable`. `run` does not start COMMAND, and `create`, `replace`, and `delete` save nothing. It
does not mean there are no variables; start the app and run it again. How to unlock the OS key
storage is in the table of the `Project environment variables` section of [Screens](/docs/screens).

Next is [frontmatter fields](/docs/ref-frontmatter).
