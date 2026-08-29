# Worker environment variables

Set a value in the worker file **before** it sources `tick.sh` and it overrides the default. The
only line that has to be there is the source line. Everything below is optional. The source itself
is in [`tick.sh`](https://github.com/proofer-tech/dira/blob/master/tick.sh).

## Worker settings

| Variable | Default | What it does |
|---|---|---|
| `TICKET_NAME` | the worker filename (without `.sh`) | Log prefix, and how the ticket's `owner` is written |
| `TICKET_CWD` | the parent of the queue root | The working directory of a dispatched session |
| `TICKET_PERSONAS` | `<root>/personas` | The persona profile directory |
| `TICKET_ONTOLOGY` | `<root>/ontology` | The ontology directory. You can redefine it as an absolute path outside this worktree |
| `TICKET_PROTOCOLS` | `<root>/protocols` | The collaboration protocol directory. The `AGENTS.md` inside it is inlined into every prompt |
| `TICKET_CONTEXT` | (none) | A `("<path>\|<description>" ...)` array. It is attached to the tail of the prompt as reference material. A path that does not exist is skipped with only a `WARN` |
| `TICKET_ENGINE` | `(claude -p --session-id "{sid}" --dangerously-skip-permissions --input-format stream-json --output-format stream-json --verbose)` | The argv of the engine to run. `{prompt}` and `{sid}` are substituted right before the run. The default engine takes streaming input, so even the first prompt arrives on stdin (a FIFO). [Talking to a running session](/docs/barge-in) is that channel |
| `TICKET_PROMPT_FMT` | `%s 티켓을 확인해 주세요. (...)` | A printf format. `%s` is the ticket hash and nothing else |
| `TICKET_INPROGRESS` | `.wip` | The filename suffix for the in-progress state |
| `TICKET_DONE` | `.done` | The filename suffix for the done state |
| `TICKET_MAXRUN` | `5400` (seconds) | The cap on one session's run. Past it, TERM → KILL, then back to the backlog |
| `TICKET_FEED_TIMEOUT` | `120` (seconds) | How long to wait for the first prompt to get all the way through the FIFO. Streaming-input engines only; if the engine does not read stdin within it, the run fails as `STALL` |
| `TICKET_REUSE` | `1` | Session reuse. A session that finishes one ticket does not die, and takes the next ticket where it stands. `0` turns it off, and a new session starts for every ticket |
| `TICKET_REUSE_CTX` | `100000` | The context cap for allowing a handover. If the last assistant turn of the stretch that just ended used more context than this (`input` + `cache_creation` + `cache_read`), the session ends instead of taking another ticket |

There is no setting for the queue root. Where the worker file sits decides the root on its own.
Reading the real `session_id` out of the response JSON and correcting the frontmatter with it is a
`claude`-only step, so another engine simply skips it.

A persona overrides the engine once more. After the ticket's `persona:` is settled, if a
`<persona directory>/<name>/engine` file exists, that file is read and this array is built again
from it ([Personas](/docs/personas), §Dispatch policy). What you wrote in the worker file survives
only for personas that have no such file.

## Machine-local state

This one changes only through the environment at the moment of the call. It is not a value you
write in the worker file.

| Variable | Default | What it does |
|---|---|---|
| `TICKET_LOCAL` | `~/.config/dira` | Where the token (`oauth-token`) and the worker lock (`run/`) are kept. Even when the queue root is on a shared drive, this belongs to this machine alone |

Next is [CLI](/docs/ref-cli).
