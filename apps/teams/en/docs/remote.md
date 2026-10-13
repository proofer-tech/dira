# Remote queue

> As of 2026-10-11 the remote queue (`remote.py` and the `dira remote` command) is still being built.
> This chapter describes the finished behavior. If the terminal says `command not found: dira`, your
> shell cannot find `dira`; see the PATH note under [Connecting](#connecting). If you get
> `dira remote: 클라이언트가 설치되지 않았습니다` ("the client is not installed"), the remote queue has
> not reached your install yet.

A web service hands out jobs, and dira on your computer picks them up and runs them. The server only
creates and distributes jobs; it never runs a model. Sessions run on this computer, and the results
and the ontology originals stay in this computer's queue.

You connect one project at a time. A project you have not connected runs exactly as before. If the
queue root has no `remote.json`, every remote step does nothing and exits.

## Connecting

From a terminal, run this with the queue root of the project you want to connect. `<server>` is the
address the web service gives you.

```sh
dira remote connect <server> --root ~/Projects/myproject/.dira
```

The `dira` command lives in `~/.config/dira/bin`. If your shell is zsh or bash, opening the dira app
once is enough. On launch the app appends a block that adds this directory to PATH (it starts with
`# >>> dira >>>`) to the end of `~/.zshrc` for zsh or `~/.bash_profile` for bash, once. Terminal
windows that were already open have not read that block, so open a new window after starting the
app. If the file already mentions `.config/dira/bin`, the app leaves it alone.

If you use the engine without the app, or another shell such as fish, add one line yourself. The
commands below do nothing when the line is already there, so running them twice is safe.

```sh
# zsh (for bash, use ~/.bash_profile instead of ~/.zshrc)
grep -qs '.config/dira/bin' ~/.zshrc || echo 'export PATH="$HOME/.config/dira/bin:$PATH"' >> ~/.zshrc

# fish
fish_add_path ~/.config/dira/bin
```

You are ready when `command -v dira` in a new terminal window prints a path ending in
`/.config/dira/bin/dira`.

1. The command prints a confirmation code (`user_code`) and an address (`verification_uri`).
2. Open that address in a browser and enter the code to approve. This computer joins the workspace
   you approved it for.
3. Meanwhile the command keeps asking the server whether you approved, and once you have, it does
   the rest. If the code expires first, it exits with rc 1; run it again from the start.

After approval the command does four things.

- It writes the credentials to
  `~/.config/dira/remote/<workspace_id>/roots/<root key>/credentials.json` (mode `0600`) and the
  connection settings to `remote.json` in the queue root. The root key is a 16-character value
  computed from the queue root's real path, so each queue root gets its own directory.
- It registers this computer as a runtime. A runtime is one computer paired with one AI tool, so
  each tool in `~/.config/dira/bin/engines/` (`claude` `codex` `agy` `grok`) is registered
  separately, and its login is checked once.
- If the queue has no worker, it creates `workers/w1.sh` and adds the
  [two crontab lines](/docs/cron).
- It ends by printing two reminders: grant Full Disk Access, and get a long-lived token with
  `claude setup-token`. Sessions started by cron cannot run without both. The steps are in
  [Authentication](/docs/auth).

A project connects to one workspace only. Connecting an already-connected project to a different
workspace is refused with `이 프로젝트는 이미 다른 워크스페이스에 연결돼 있습니다` ("this project is
already connected to another workspace") and rc 2. To switch workspaces, disconnect first.

The other direction is fine: one computer can connect several projects to the same workspace. Run
`dira remote connect` once per project, each with its own `--root`. Credentials, the last sync time,
and the ontology manifest are stored per queue root, so a project you connect later does not
overwrite the token of one you connected earlier. Only the tool versions and login check results
(`health.json`) describe the computer itself, so the workspace directory keeps one copy that all its
projects share.

If you move a queue root to a different path, its root key changes and the credentials are no longer
found. Connect again from the new path.

## Disconnecting

```sh
dira remote disconnect --root ~/Projects/myproject/.dira
```

This tells the server you are leaving, then deletes `remote.json` and that project's whole root
directory (`roots/<root key>/`). Other projects connected to the same workspace keep their
credentials and `health.json`, and they keep syncing. It leaves the crontab lines alone. The worker keeps running, but now handles local tickets only. To
stop the worker too, remove the two crontab lines as described in [cron](/docs/cron).

## Why a job from the web starts late

dira has no process that stays running. cron starts a worker once every 30 seconds, and right before
picking a ticket the worker exchanges one round of messages with the server. That round is called a
sync. A job you start on the web comes down to this computer at the next sync, and its session starts
in that same run. So you may wait up to about 30 seconds.

With no free worker, you wait longer. Each sync fetches only as many jobs as the queue has free
workers, so if every worker is holding another ticket, the job stays on the server until one
finishes.

On every sync, each worker reports its next run time and the ticket it currently holds. The web
screen can use those values to show when a job will start.

A fetched job becomes an ordinary ticket in your queue. The only difference is
`remote_job: <job_id>` in its frontmatter. It looks like any other ticket in the app, and it is
claimed and finished by the same rules.

## What goes to the server, and what does not

This is everything that goes to the server.

| What | When |
|---|---|
| Computer name, project, AI tool names, versions, and login status | On connect and every sync |
| Each worker's next run time and the hash of the ticket it holds | Every sync (the heartbeat) |
| A remote job's state (`running` `awaiting` `done` `failed`) | When it changes |
| Progress - step names and the shell commands the session ran | While a remote job runs |
| The `## 질문 n` (question) section that asks a person | When a remote job waits for an answer |
| Contents of the `.md` files under the ontology's `objects/` and `versions/` | When they change or are deleted |

There are four progress steps: the first time the session reads a file (`read`), the first time it
edits one (`wrote`), when it creates a new ticket (`handoff`), and when it starts waiting for an
answer (`awaiting`). Each shell command is cut at 2,000 bytes.

What never goes to the server:

- **Your subscription login token.** The token from `claude setup-token` is never read or sent.
- **Session transcripts.** What the model wrote, what tools returned, and its reasoning are not sent.
- The state and progress of local tickets that are not remote jobs.

The runtime token the server issues is kept only under `~/.config/dira/remote/`. It is never written
to the queue root, tickets, or logs. Each job also gets its own job token, kept in
`~/.config/dira/run/remote-jobs/`, passed only to that job's session as environment variables
(`DIRA_REMOTE_URL` `DIRA_REMOTE_TOKEN`), and deleted when the job finishes.

## What comes down from the server

- **Jobs.** They become tickets, as described above.
- **Answers to questions.** Written as `tickets/<question ticket hash>.done.md`. If that file already
  exists it is not overwritten; dira takes it as a person having answered locally first.
- **Persona bundles.** The server's personas are installed into `personas/<name>/`, with a `.remote`
  file marking them as coming from the server. If you already have your own persona with the same
  name, it is not overwritten; only that name is skipped.
- **Ontology schema bundles.** Type definitions are added under `_ontology/`. If a file at the same
  path exists with different contents, the whole bundle is refused.
- **Ontology edits.** Objects edited on the web are written under `objects/` and `versions/`. Right
  before writing, dira checks that the file is still the version the web saw. If it was changed on
  this computer in the meantime, it does not write and reports a conflict.

Persona and schema bundles are checked for a new version every 10 minutes.

## When something goes wrong

A failing remote step never stops the worker. Local tickets keep running, and the worker log gets
one line, `REMOTE <reason>`.

| Log or state | Meaning and what to do |
|---|---|
| `REMOTE unauthorized` | The server rejected the runtime token. Sync has stopped; disconnect and connect again |
| A tool is reported as `needs_check` | That AI tool failed its login check, and it gets no jobs. Log in to it again ([Authentication](/docs/auth)) |
| `remote_revoked: true` in a ticket's frontmatter | This computer went quiet for too long and the server took the job back. That ticket's state is no longer reported |
| `REMOTE persona-skip <name>` | You have your own persona with that name, so the server's persona was not installed |

The login check runs on connect, every 6 hours, and right after a session on that tool ends with an
authentication error.

Next is [Troubleshooting](/docs/troubleshooting).
