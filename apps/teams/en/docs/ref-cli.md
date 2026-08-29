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

Next is [frontmatter fields](/docs/ref-frontmatter).
