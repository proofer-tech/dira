# Engine MCP

> As of 2026-10-11 the engine ships the MCP server (`mcp_server.py`). The `dira mcp` command, the
> app starting the HTTP server, and the `MCP` section in settings are still being built. If
> `dira mcp` fails with a command-not-found error or settings has no `MCP` section, point your
> client at the server with `python3` as in [Connecting without the app](#connecting-without-the-app).

Any client that speaks MCP (Claude Code, Claude Desktop, Cursor, and so on) can work a dira queue.
You create tickets, read them, append sections, run workers, and interject in running sessions from
inside that client's conversation. Every engine operation you do from the app or a shell can also
be done over MCP.

## What you can do

Common operations are named tools.

| Tool | What it does |
|---|---|
| `projects` | Returns the projects registered in the app and their queue roots (`~/.config/dira/gui-projects.json`) |
| `queue_list` | Open tickets. Same as `<w>.sh list` |
| `dispatch` | Runs a worker once. Pass the worker name in `worker` |
| `dryrun` | Shows what would be picked, without running anything |
| `reap` | Reclaims tickets whose session died |
| `unassign` | Releases a ticket. Arguments `hash` and `force` |
| `ticket_find` | Finds a ticket's path by hash (`tickets.py find`) |
| `ticket_read` | Reads a ticket's full body |
| `ticket_create` | Creates a new `<8-char hash>.md` from frontmatter and body. Fails if the hash exists |
| `ticket_append` | Looks up the hash's current filename again and appends a section. Fails on zero or two-plus files |
| `ticket_done` | Renames `.wip` to `.done`. No other rename |
| `interject` | Sends one interjection line to a running session, by the same path as the screen's interject |
| `graph_query` | Asks the ontology (`graph.py query`) |
| `env_list` `env_create` `env_replace` `env_delete` | Manage project environment variables. Values never appear in a response |

Anything not in that table goes through `engine_exec`. Give `program` one entry from the allowlist
below and `args` an array of arguments. It runs without a shell and returns `{rc, stdout, stderr}`.
The `timeout` limit defaults to 600 seconds.

- `tickets.py` `graph.py` `learn.py` `dira_env.py`
- `workers/<w>.sh` - only worker files that actually exist inside the queue root
- `push.sh` `token-rotate.sh` - `push.sh` takes `cwd`, which must be an existing directory under the queue root's `worktrees/`

For example, to claim a ticket by hand with `handclaim`, set `program` to `tickets.py` and `args` to
`["handclaim", "<ticket path>"]`. When the engine gains a subcommand, it is reachable this way too.

### Choosing the queue

Every tool takes the queue root (`<project>/.dira`) as `root`. Without it the tool uses the
`TICKET_ROOT` environment variable, and without that it fails with `root가 필요합니다` (root is
required). If you don't know the root, call `projects` first. If you only work one project, set
`TICKET_ROOT` in the client's config.

### What MCP will not do

The queue rules hold over MCP. The only way to claim a ticket is the atomic link in `tickets.py`,
and the only tool that renames a ticket is `ticket_done`. No tool runs `push --force`,
`reset --hard`, `stash`, or a push to a remote.

## Connecting a client

There are two ways to connect: stdio and HTTP. The `MCP` section in settings shows the config for
both, each with a copy button. Paste the one you pick into your client's MCP server settings as one
server. Which file it goes in and what wraps it differ by client, so follow that client's docs.

### stdio - `dira mcp`

```json
{"command":"dira","args":["mcp"]}
```

The client starts `dira mcp` when it needs it and stops it when done. The app can be closed. As
long as the engine is installed, this always starts. To pin the queue root, put `TICKET_ROOT` in the
environment part of the client's config.

### HTTP - the server the app runs

```json
{"type":"http","url":<url>,"headers":{"Authorization":"Bearer <token>"}}
```

The copy in settings already has `<url>` and `<token>` filled in. The server listens on `127.0.0.1`
only and rejects requests with a missing or wrong token with `401`. Browser requests from other
sites get `403`.

**The token is new every time the app starts.** After restarting the app, copy the HTTP config from
settings again and paste it into your client. The old token gets `401`. The current values are also
in `url` and `token` of `~/.config/dira/run/mcp.json`.

### Connecting without the app

If you cloned only the engine with `git clone`, point `python3` at `mcp_server.py` in the engine
repo. Replace the path with wherever you cloned it.

```json
{"command":"python3","args":["/Users/<you>/Projects/dira/mcp_server.py"]}
```

## When the app closes, HTTP goes with it

The engine has no resident process. cron starts a worker once a minute and it exits. The desktop app
is the only thing that stays up, so the app owns the HTTP server.

- When the app starts, the HTTP server starts and `~/.config/dira/run/mcp.json` gets
  `{url, token, pid, started_at}`.
- If the server dies before the app, the app starts it again one second later and rewrites
  `mcp.json` with the new values.
- If it dies 5 times within 60 seconds, the app stops restarting it and the tray menu shows an
  item saying the MCP server stopped, with a restart option. Clicking it starts the server again.
- When you quit the app, the server stops and `mcp.json` is deleted.

The status line in the settings `MCP` section shows where things stand. On, followed by the URL,
means you can connect over HTTP. Off means no app-run server is up. Opened in a browser, the page
shows a note that HTTP is available in the app only, instead of the HTTP config.

stdio runs whether or not the app is up. If you close the app often or use the engine alone, connect
with stdio. The `env_*` tools are the exception: like `dira env` in [CLI](/docs/ref-cli), they need
the app running to read or write values.

Next is [Troubleshooting](/docs/troubleshooting).
