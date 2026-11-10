# Engine MCP

> The `dira mcp` command, the HTTP server, and the `MCP` section in settings ship
> in v1.2.19 and later. If `dira mcp` fails with a command-not-found error or settings has no `MCP`
> section, your app is older than that. Update the app to v1.2.19 or later. If you can't update
> right now, point your client at the server with `python3` as in
> [Connecting without the app](#connecting-without-the-app).

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
| `awaiting_list` | Collects tickets awaiting an answer, with their questions. Without `root` it scans every registered project. See [Handing answers to another agent](#handing-answers-to-another-agent) |
| `ticket_answer` | Answers a ticket that is awaiting an answer. Creates the same file as the screen's `Write an answer` form |
| `graph_query` | Asks the ontology (`graph.py query`) |
| `ontology_objects` `ontology_object` `ontology_search` | Read ontology objects as a list, one at a time, or by search. See [Reading the ontology](#reading-the-ontology) |
| `ontology_versions` `ontology_version` `ontology_schema` | Read an object's past versions and the ontology schema. See [Reading the ontology](#reading-the-ontology) |
| `env_list` `env_create` `env_replace` `env_delete` | Manage project environment variables. Values never appear in a response |
| `project_register` | Registers a queue you already made in the app's project list. Arguments `path` `name` `id`; it runs the same checks as registering on the screen. See [Handing project registration and settings to another agent](#handing-project-registration-and-settings-to-another-agent) |
| `project_rename` | Renames a registered project. Arguments `id` `name` |
| `project_reorder` | Reorders the project list. Argument `ids` |
| `project_unregister` | Removes a project from the list only. Queue files are not deleted |
| `settings_get` | Reads this computer's settings (language, autonomy, autopilot, multi-account, session limit) |
| `settings_set` | Changes only the settings of this computer you pass as arguments |
| `project_settings_get` | Reads one queue's integration branch, `Empty the working tree while idle` state, and worker list |
| `project_slim` | Turns one queue's `Empty the working tree while idle` on or off |
| `ops_status` | Tells you whether the executor tools are attached. See [Creating and configuring a project without the screen](#creating-and-configuring-a-project-without-the-screen) |

Work that used to be screen-only, such as creating a project, adding a worker, or editing a persona,
attaches separately as executor tools. There are too many names for the table above, from
`project_create` to `ticket_save`, so they are grouped in [Executor tool list](#executor-tool-list).

Anything not in that table goes through `engine_exec`. Give `program` one entry from the allowlist
below and `args` an array of arguments. It runs without a shell and returns `{rc, stdout, stderr}`.
The `timeout` limit defaults to 600 seconds.

- `tickets.py` `graph.py` `learn.py` `dira_env.py`
- `workers/<w>.sh` - only worker files that actually exist inside the queue root
- `push.sh` `token-rotate.sh` - `push.sh` takes `cwd`, which must be an existing directory under the queue root's `worktrees/`

For example, to claim a ticket by hand with `handclaim`, set `program` to `tickets.py` and `args` to
`["handclaim", "<ticket path>"]`. When the engine gains a subcommand, it is reachable this way too.

### Reading the ontology

The six tools starting with `ontology_` read the `.md` files under the ontology location's
`objects/` `versions/` `_ontology/` directly and return JSON. They arrive in a version later than
v1.2.19, so if no tool name starting with `ontology_` appears in the tool list, update the app. They
go through the same code the web uses to view the ontology in the
[remote queue](/docs/remote#viewing-the-ontology-on-the-web), so both give the same answers. Every
call reads the files fresh.

| Tool | Arguments | Returns |
|---|---|---|
| `ontology_objects` | `types` `cursor` `limit` | The objects under `objects/`, in path order, without bodies. `limit` defaults to 200, at most 1,000. If more remain, a `cursor` is attached; call again with that value as `cursor` for the next page |
| `ontology_object` | `name` `backlinks` | One object plus its body (`body`) and the raw file (`content`). If there is none, `object` is `null`. With `backlinks` set to `true` it also returns the links that point at this object |
| `ontology_search` | `q` `types` `limit` | Objects whose name, title, property values, or body contain `q`, each with about 100 characters around the first match (`excerpt`). Matches on name or title come first. `limit` defaults to 20, at most 100 |
| `ontology_versions` | `name` | That object's past versions, each with version name, path, `sha256`, and modified time |
| `ontology_version` | `name` `version` | The raw text and `sha256` of one past version. If there is none, `content` is `null` |
| `ontology_schema` | none | The object type (`object_types`) and link type (`link_types`) definitions in `_ontology/` |

An object comes as `{name, type, path, sha256, title, props, links}`. `props` is the frontmatter
minus `name` `type` `links`, and `links` is `[{type, to, props}]`. A file whose frontmatter cannot be
parsed is left out of the objects and listed in `errors` with its path and a reason. The five
reasons are in [Remote queue](/docs/remote#viewing-the-ontology-on-the-web). `ontology_objects`
carries `errors` only on the first page.

`graph_query` asks questions of the graph built from the ontology; these six read the file contents
as structure. When you need one object's properties or body, call `ontology_object`.

Remote job sessions do not get this MCP server automatically. For a session there to use these
tools, the persona's `mcp.json` must include the `dira mcp` server.

### Handing answers to another agent

A ticket whose session left a `## 질문 n` section and stopped is locked as
[awaiting an answer](/docs/states#three-markings-that-are-not-lanes). You don't have to answer it on
the screen. Hand it to another agent that has dira MCP connected (Claude Cowork, for example), and
that agent handles it with two tools, without opening a browser. If `awaiting_list` and
`ticket_answer` are missing from the tool list, update the app.

You can hand it over like this.

> Using dira MCP, collect the tickets awaiting an answer across the registered projects, and answer
> each question by picking options or writing the answer yourself. If you can't decide on a
> question, don't answer it; ask me.

The agent calls `awaiting_list` first. With `root` it looks at that queue only; without it, every
registered project. The tickets it returns are the same ones that carry the `Awaiting answer` badge on
the screen. They come in project order, and within a project the ticket that has waited longest comes
first. A project whose queue root can't be read is skipped and listed in `skipped` with the project
and the reason. Each item carries these values.

| Key | Meaning |
|---|---|
| `project` `root` | Project name and queue root |
| `hash` `title` `persona` | Ticket hash, title, and assigned persona |
| `awaiting` | The hash that becomes the answer file's name |
| `round` `question` | The `n` of the last `## 질문 n` section, and that section in full |
| `items` | The questions read from that section, `[{number, title, options: [{letter, label}]}]` |

`items` only reads a section whose questions start with `### 1.` or `### 1-1.` and whose options
start with `(a)` or `(a-1)`. For a section in any other shape, `items` comes back as an empty array;
the agent then reads the full `question` and writes the answer itself.

The answer goes to `ticket_answer` along with `hash`. There are two arguments for the answer,
`picks` and `text`, and at least one is required. Given both, the lines built from `picks` come
first, then one blank line, then `text`.

- `picks` is the chosen options, shaped `[{number, letters, note}]`. `number` is the question number
  (the `number` in `items`), `letters` is an array of the chosen letters, and `note` is anything to
  add to that question. `note` is optional. `picks` turns into the same line the screen builds when
  you pick options. For example, `{"number": "1", "letters": ["a", "a-1"]}` becomes the single line
  `1.(a)(a-1)`.
- `text` is an answer written out. Use it when no option fits or `items` is empty.

`ticket_answer` checks in the same order as the screen, and if any check fails it creates no file.
The ticket must be awaiting an answer right now, and the same answer must not exist yet. The numbers
and letters in `picks` must actually appear in the last question section, and a sub-letter such as
`a-1` is accepted only when its parent letter `a` is picked too. The error message says which check
failed.

Once the checks pass, it creates `tickets/<awaiting>.done.md`, identical down to the character to the
file the screen's `Write an answer` form creates. The moment that file exists the lock is released and the
ticket goes back on the queue for a worker to pick up. The tool then wakes a worker once. The
response is `{path, round, body, dispatch}`, with that result in `dispatch`. If waking the worker
fails, the answer file still stays, and the next worker run picks the ticket up.

### Handing project registration and settings to another agent

The app's project list and settings can be changed over MCP too. The tools write the same files the
screen writes, in the same format, so whatever an agent changes shows up on the app screen as is. If
`project_register` and `settings_set` are missing from the tool list, update the app.

You can hand it over like this.

> Using dira MCP, register `~/Projects/shop/.dira` under the name `shop` and move it to the top of the
> project list. Have that queue empty its working tree while idle, and set this computer's session
> limit to 4.

#### The project list

The four project tools edit `~/.config/dira/gui-projects.json`. They pick a project by `id`, not by
queue root; `projects` tells you each project's `id`. The response is the whole project list after
the change.

`project_register` takes the queue root (`<project>/.dira`) in `path` and the name shown on the
screen in `name`. Without `id`, one is made from the name: lowercased, with every run of characters
other than ASCII letters and digits turned into `-`, at most 40 characters. The checks run in the
same order as on the screen.

1. Is the name non-empty?
2. Is the path absolute and an existing directory? (A leading `~` expands to your home.)
3. Does it contain `tickets` or `workers`?
4. Is neither the same queue nor the same `id` registered already?

If any check fails, the list is not written and the tool ends with an error saying which check
failed. Once check 3 passes, the tool looks for a `.dira` line in the `.gitignore` of the queue's
parent directory and adds it on the spot if missing. The screen does the same, so the line stays even
if check 4 then fails. On success the new entry also comes back separately as `project`. Registering on
the screen copies the core protocol into the queue right away; registering with this tool leaves that
copy to the next time you open the app.

The other three are short.

- `project_rename` takes `id` and the new `name`. An empty name or an unknown `id` is an error.
- `project_reorder` puts the projects in `ids` first, in that order, and appends the rest in their
  original order. To move one project to the top, pass just its `id`. Unknown ids are ignored.
- `project_unregister` removes the entry from the list and nothing else. It does not touch a byte of
  the queue directory or its tickets, so you can register the same queue again later with
  `project_register`. An unknown `id` is an error.

#### This computer's settings

`settings_get` and `settings_set` read and write the settings files under `~/.config/dira/`. These
settings apply to the whole computer regardless of queue, so they take no `root`. `settings_set`
accepts these keys.

| Key | Name on the screen | Value |
|---|---|---|
| `language` | `Language` | `ko` or `en` |
| `autonomy_level` | `Autonomy` | An integer from 1 to 5 |
| `autopilot` | `Autopilot` | `true` or `false`. `true` is accepted only when autonomy is 5 |
| `multitoken` | `Allow multi-account` | `true` or `false` |
| `multiplay` | `Simultaneous multi-account use` | `true` or `false` |
| `session_limit` | machine-wide session limit | An integer 0 or above. `null` removes the limit |

`settings_set` changes only the keys you pass. It checks every value first, and if any is wrong it
writes no file at all. Changing only autonomy leaves the autopilot value alone, and changing only
autopilot leaves the autonomy level alone, the same as the two controls on the screen. So if you
lower autonomy to 4 with autopilot on, autopilot reads as off, and raising autonomy back to 5 brings it
back on. To turn on autonomy 5 and autopilot together from 4 or below, pass `autonomy_level` and
`autopilot` in the same call.

The response is the `settings_get` result after the change. `settings_get` groups autonomy and
autopilot as `autonomy: {level, autopilot}` and the session limit as `session_limit: {limit, warn}`.
A `multitoken` of `null` means nobody has set it yet, so the app build's default applies. If the
limit file can't be read, `warn` is attached.

#### One queue's settings

`project_settings_get` and `project_slim` pick the queue by `root`, like the other tools.

`project_settings_get` returns `integration_branch` (the integration branch), `slim` (the
working-tree emptying state), and `workers` (the list of worker names). If the queue's
`integration-branch` file is missing or its first line can't be read as a branch name,
`integration_branch` is `null`. The screen fills the file in from git in that case; this tool only
reads and writes nothing.

`project_slim` takes `true` or `false` in `on` and turns
[Empty the working tree while idle](/docs/screens#empty-the-working-tree-while-idle) on or off. When
you turn it on and emptying is refused, the setting is still saved as on and the reason comes back in
the response's `message`, the same as the screen switch. The rest of the response is the
working-tree emptying state after the change.

Creating a new project, creating and deleting workers, and changing the integration branch are done
by the executor tools, not by the tools in this section. See the next section.

### Creating and configuring a project without the screen

Without opening the dira screen, another agent can create a new project and set up its workers over
MCP alone. The tools that do this are called executor tools. They call the same functions the
screen's buttons call, so the same input produces the same files as a project made on the screen.

Hand it to an agent like this:

> Use dira MCP to create a project in `~/Projects/shop`. Name it `shop`, integration branch `dev`.
> Set the ontology location to `~/Drive/shop-ontology`, and have every worker read `docs/DESIGN.md`
> as reference material. Add one more worker so there are two.

#### Open the app once first

The executor tools attach after you have opened the app once. On launch the app writes where the
executor lives to `~/.config/dira/ops.json`, and the MCP server reads that file to call the executor.
Once the file exists, the executor tools keep working after you close the app, because the executor
runs on its own without the screen server.

Check with `ops_status`. It takes no arguments.

| Key | Meaning |
|---|---|
| `available` | `true` means the executor tools are usable |
| `argv` | The command the MCP server uses to start the executor |
| `error` | Why `available` is `false`. If the file is missing, it says the file appears once you open the app |

If `available` is `false`, open the dira app once and close it. If the tool list still has no
`project_create`, reconnect the dira MCP server in your client. The MCP server asks the executor for
its tools when the client fetches the tool list, so a list fetched earlier won't have them. Even
while `available` is `false`, the tools in the table above, such as `queue_list` and
`ticket_create`, work as usual.

When an executor tool fails, the error message from the executor comes back as the tool error,
unchanged. Each call has a 300-second limit. `project_create` downloads skills, so it can take a
while depending on the network.

#### The order for setting up a project

The order is `project_create` -> `project_ontology_set` -> `project_context_set` -> `worker_create`.
After `project_create`, pick the project by either `id` (the registry id) or `root` (the queue root).

**1. Create it with `project_create`.** This does what the screen's new project form does. It creates
`.dira`, puts worker `w1` in crontab, registers the project in the app's project list, and installs
the default skills.

| Argument | Screen field | What goes in |
|---|---|---|
| `path` | `Project folder` | The parent folder of `.dira`. Created if missing |
| `name` | `Name` | The name shown on the screen |
| `branch` | `Integration branch` | The branch sessions push their results to. Empty is an error |
| `ontology` | `Ontology location` | Optional. Path to the ontology folder |
| `specDoc` | `Spec document` | Optional. Path to a spec file such as `docs/DESIGN.md` |
| `id` | `URL slug` | Optional. Made from the name if omitted |

The result carries one of `error`, `exists`, or `created`.

- `error` means the input was wrong. Nothing was created.
- `exists` means the folder already has a `.dira`. Nothing was created here either. If `queue` is
  `true`, it is already a usable queue, so register it with `project_register`.
- `created` carries the new queue root in `root`. Use it as `root` in the calls that follow. If
  `cron` is `false`, every file was made and only the crontab registration failed. The reason is in
  `cronError`, and the command to register by hand is in `registerCmd`. If `ontologyError` is
  present, only the ontology location was not set; set it again in the next step.

**2. Set the ontology location with `project_ontology_set`.** It takes one argument, `path`; an
empty string clears the location. It runs the same checks as saving the ontology location on the
screen. If you passed `ontology` in step 1 and got no `ontologyError`, it is already set, and
checking `value` with `project_ontology_get` is enough.

**3. Set reference material with `project_context_set`.** Reference material is the list of files
appended to the end of the session prompt. Pass `items` as `[{path, desc}]`. Without `worker` it
writes the shared list every worker reads (`context.sh`); with a worker name such as `w1` in
`worker`, it writes that worker file's `TICKET_CONTEXT`. The `items` you pass replace the whole list,
so to keep existing entries, read them with `project_context_get` and pass them along. To copy one
worker's list to another, give `project_context_copy` a `from` and a `to`.

**4. Add workers with `worker_create`.** Pass a name such as `w2` in `name`. `engine`, `model`, and
`effort` are optional and default, as on the screen, to `claude` and `No model`. It writes the worker
file, puts it in crontab, and creates the worktree. Once the new name shows up in
`project_settings_get`'s `workers`, it is done.

There are tools for changes after creation too.

- `project_settings_set` changes only the keys you pass, out of `integration_branch` and `slim`.
  Changing the integration branch also rewrites the places in the queue that use that name, as the
  screen does.
- `worker_stop` and `cron_unregister` remove only the worker's crontab line, and `cron_register` puts
  it back. The worker file and worktree stay.
- `worker_delete` deletes a worker. A worker with a running session is not deleted; the call fails
  with an error.

#### Executor tool list

The names are grouped the way the screen groups them. A name ending in `*` stands for several tools
starting with that prefix; `tools/list` has the exact names and arguments.

| Group | Tools |
|---|---|
| Creating a project | `project_create` |
| Project settings | `project_settings_set` |
| Ontology location and reference material | `project_ontology_get` `project_ontology_set` `project_context_get` `project_context_set` `project_context_copy` |
| Workers | `worker_list` `worker_create` `worker_delete` `worker_stop` `worker_retry_worktree` `cron_register` `cron_unregister` |
| Worker fix buttons | `project_repair` - pick what to fix with `kind` |
| Personas | `persona_*` |
| Squads | `squad_*` |
| Trash | `trash_*` |
| Skills | `skill_list` `skill_install` - install by address only |
| Market | `market_*` |
| Protocols | `protocol_*` |
| Epics | `epic_*` |
| Commands and schedules | `command_*` `schedule_*` |
| Ticket editing | `ticket_save` `ticket_frontmatter_set` `ticket_epic_set` `ticket_delete` `ticket_followup` `polling_dispatch_now` `polling_extend` `backoff_retry_now` |
| Ontology writes | `ontology_save` `ontology_create` `ontology_delete` `ontology_rename` `ontology_fix_schema` `ontology_publish_migration` `ontology_publish_import` `ontology_survey_submit` `ontology_metrics` |
| Emergency stop | `emergency_stop_get` - read only |

#### What MCP can't do

These stay on the screen.

- Turning emergency stop on or off. It is the safety switch a person throws to stop sessions, so an
  agent can't release it. Read whether it is on with `emergency_stop_get`.
- Credentials: tokens and accounts, engine profiles, login setup, Vercel, and webhooks. These are
  secrets, so they never pass through MCP responses.
- Usage statistics consent. A person consents to it directly, so there is no way for an agent to
  turn it on or off.
- Screen interaction: the home conversation, terminal, source control, explorer, browser tabs,
  selfish mode, and keyboard shortcuts. These handle screen state, so opening them over MCP would not
  let an agent do anything more. An agent uses the shell, git, and files directly.
- File uploads. Installing a skill from an uploaded file and ticket attachments are not accepted.
  Give `skill_install` an address instead.

### Choosing the queue

Every tool takes the queue root (`<project>/.dira`) as `root`. Without it the tool uses the
`TICKET_ROOT` environment variable, and without that it fails with `root가 필요합니다` (root is
required). `awaiting_list` is the one exception: without `root` it scans every registered project.
The four project tools and `settings_get` `settings_set` don't pick a queue, so they take no `root`.
Executor tools also accept a registry `id` instead of `root`, and they don't handle queues that are
not registered in the app.
If you don't know the root, call `projects` first. If you only work one project, set
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

### HTTP - the server cron keeps up

```json
{"type":"http","url":<url>,"headers":{"Authorization":"Bearer <token>"}}
```

The copy in settings already has `<url>` and `<token>` filled in. The server listens on `127.0.0.1`
only and rejects requests with a missing or wrong token with `401`. Browser requests from other
sites get `403`.

**Paste it once and keep using it.** The token is created once, stored in
`~/.config/dira/mcp/token`, and reused every time the server starts again. The server tries port
`47823` first. If another program holds that port it picks a free one, and then the URL changes, so
copy the HTTP config from settings again. The current values are also in `url` and `token` of
`~/.config/dira/run/mcp.json`.

In v1.2.20 and earlier the app ran the HTTP server itself and made a new token on every start. If
you're coming from one of those versions, copy the HTTP config once more after updating.

### Connecting without the app

If you cloned only the engine with `git clone`, point `python3` at `mcp_server.py` in the engine
repo. Replace the path with wherever you cloned it.

```json
{"command":"python3","args":["/Users/<you>/Projects/dira/mcp_server.py"]}
```

## HTTP stays up with the app closed

cron keeps the HTTP server up, the same way it runs workers. Open the dira app once and it sets up
two things.

- It puts a watcher script at `~/.config/dira/mcp/keepalive.sh`.
- It adds one crontab line that calls that script every minute. If the line is already there it
  leaves it alone, and it never touches other lines.

```
* * * * * "<home>/.config/dira/mcp/keepalive.sh" "<engine>/tick.sh" >> "<home>/.config/dira/run/mcp.log" 2>&1
```

`<engine>` is the same place as the `tick.sh` your worker cron lines call. Right after adding the
line, the app runs the script once itself, so the server starts without waiting for the next
minute.

From then on cron calls the script every minute, app or no app. If the `pid` in `mcp.json` is a
live `mcp_server.py`, the script exits without doing anything. If the server is down, it starts it
again with the same token and rewrites `mcp.json` with the new `pid`. A dead server is back within a
minute at the same URL with the same token, so your client config doesn't need to change.

The status line in the settings `MCP` section reads `mcp.json` and shows where things stand. The app
window and the page opened in a browser see the same value. On, followed by the URL, means you can
connect over HTTP. Off means no server is up, and a line under it says that opening the dira app once
lets cron start it.

### When the server won't start

If it stays Off for more than a minute, check two places.

```bash
crontab -l | grep 'mcp/keepalive.sh'
tail -n 20 ~/.config/dira/run/mcp.log
```

- No line in `crontab -l` means the app couldn't write to crontab. macOS asks for the
  `App Management` permission when the app edits crontab, and denying that prompt ends here. Approve
  dira under `System Settings › Privacy & Security › App Management` and open the app again.
- If the line is there but no server is, read `mcp.log` from the bottom. Every time cron calls the
  script, whatever the script and the server print lands in this file.

### Removing dira takes it down too

Every minute the watcher first checks that the `<engine>/tick.sh` it was given exists. If that file
is gone, it takes dira as removed and cleans up.

- It stops the running `mcp_server.py`.
- It deletes `~/.config/dira/run/mcp.json`.
- It removes only the `mcp/keepalive.sh` line from crontab. Other lines stay byte for byte.
- It deletes `~/.config/dira/mcp/`, token included.

Workers drop their cron lines on the same `tick.sh`, so the MCP server goes down at the moment the
workers stop. Reinstall dira and open the app, and the line and script come back. The token is new,
so copy the HTTP config into your client again.

stdio doesn't depend on cron: the client starts it only when it needs it. If you'd rather not keep a
port open, connect with stdio. The `env_*` tools are the exception: like `dira env` in
[CLI](/docs/ref-cli), they need the app running to read or write values.

Next is [Remote queue](/docs/remote).
