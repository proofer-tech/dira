# Install

Download the `.dmg` from the
[latest release](https://github.com/proofer-tech/dira/releases/latest), open it, and drag
`dira.app` into `Applications`. The app fetches updates on its own.

## What you need

Two things. Even if you have neither right now, following the order below gets you there.

### 1. An Apple Silicon Mac

The app runs here and nowhere else. Open the Apple menu at the top left and choose
`About This Mac`. If `Chip` starts with `Apple M`, you are fine. On an Intel Mac the app will
not run, and your route is
[Running the engine without the app](#running-the-engine-without-the-app) below.

### 2. Setting up an engine

To drive dira you need one LLM engine you can call from the CLI. That is what a worker starts
when it takes a ticket, so without it a ticket never moves out of `Open`. The default is
[`claude`](https://claude.com/claude-code).

Open the `dira.app` you just moved and press `Settings` at the far right of the header. Look at
the top line of `Authentication` › `claude`. If the engine is installed, `claude CLI —` is
followed by the path the app found. If it is not, the line reads
`No claude CLI here — workers can't start a session`.

Once you have installed the engine, quit the app, open it again, and look at the same line. The
list of paths the app searches for programs is decided once, at launch. When that line has
turned into a path, you are ready.

While a worker holds a ticket and runs this engine, macOS may ask you for permission or for
keychain access. The name in the dialog shows up as a number (`2.1.222`, say) rather than dira,
because the worker is running exactly the CLI engine you just configured. Nothing unfamiliar
has appeared. The engine itself needs that dialog, so go ahead and allow it.

`python3` and `bash` already ship with macOS. The engine itself uses nothing but the standard
library of those two. The `apm` command that installs persona and protocol packages is something
dira installs on its own when it needs it (§Installing packages on a new machine below).

## Installing packages on a new machine

Personas, squads and protocols live as packages under the project repository's `dira-team/`, and
which ones at which version is pinned by `dira-team/apm.yml` and `dira-team/apm.lock.yaml`. The
install output (`dira-team/apm_modules/`, `dira-team/.claude/`) is not committed, so after you clone
the repository on a new machine you install once. It is one command.

```bash
cd ~/Library/Application\ Support/dira/engine     # the engine inside the app; with the repo, your clone
python3 dira_apm.py install <project root>
```

`<project root>` is the repository folder that contains `dira-team/`, not the `.dira` folder. With
the app you will rarely type this yourself: before claiming a ticket, a worker checks the install
and, if it differs from the lock, installs once on its own. The command does four things.

1. If there is no `apm` command yet, it installs one first. The version is the one line in the
   engine's `apm-version` file (`0.33.0` today), and the place is `~/.config/dira/tools/apm/<version>/`.
   With `uv` it installs through `uv`; without it, it makes a virtual environment there with a
   `python3.x` of 3.10 or later. An `apm` you put on your own PATH is not used.
2. It installs from the lock, at the repository root if there is an `apm.yml` there, and in
   `dira-team/` if there is a `dira-team/apm.yml`.
3. It checks the result (`check`).
4. It rewrites the queue's `.dira/protocols/`
   ([Protocols](/docs/protocols#the-source-of-truth-is-a-package-dira-protocols-is-generated)).

If the last lines show no error, you are done. To only look at the current state, put `check` where
`install` is. It installs nothing, prints one line per mismatch, and exits with rc 1 if there is any.

With neither `uv` nor a `python3.x` of 3.10 or later, it stops with
`apm 설치 실패: uv도 python3.10 이상도 없다` (apm install failed: no uv and no python3.10 or later).
The `python3` that ships with macOS is 3.9 and does not count. Install `uv` and run it again.

## `Stalled: Package install differs from the lock`

Before a worker claims a ticket, it checks that the project's packages match the lock. If they do
not, it tries one install from the lock; if they still differ, it claims no ticket in that
project. That is when `Stalled: Package install differs from the lock` and a one-line detail attach
after the `Next dispatch` clock in the status bar at the bottom of the screen. The project's
`runner.log` gets this line.

```text
SKIP apm 설치 상태가 lock과 다르다 - <one-line detail>
```

It tries the install only once per lock, so this does not clear by itself.

1. Run the command from §Installing packages on a new machine above, as is. That fixes most
   cases, and the worker claims tickets again on the next tick.
2. If the same line stays, read the lines `check` printed. Each starts with one of these four.
   - `스킬 이름 충돌: <skill> <- <package>, <package>` (skill name clash) - two packages ship a
     skill by the same name. Drop it from one, or rename it.
   - `페르소나 <name>: skills.md의 <skill>가 패키지 폐포에 없다` (not in the package closure) - that
     skill is installed by another package but not by this persona package or its dependencies. Put
     it in the persona package's `.apm/skills/`, add the package that has it as a dependency, or
     delete that line from `skills.md`.
   - `apm_modules 사본이 원본과 다르다: <package>` or `원본 없음: <package>` (copy differs from the
     source, source missing) - a local package was edited or moved and not installed again. Run the
     command in 1 again.
   - `dira-team: apm audit rc 1: ...` - the installed files differ from the lock. Often someone
     changed `dira-team/apm.yml` and did not commit the lock, so check `dira-team/apm.lock.yaml`.
     If the dependency change is intended, run `~/.config/dira/tools/apm/<version>/bin/apm install`
     in that folder to write a new lock, and commit it.
3. After fixing, run the command in 1 once more.

To keep the worker from trying an install, as in tests, set the environment variable
`DIRA_APM_NO_INSTALL=1` ([Worker environment variables](/docs/ref-env#machine-local-state)). How
this ranks against other stall reasons is in the table in [Troubleshooting](/docs/troubleshooting).

## The screen blurs after an update

> As of 2026-10-16 this screen is still being built. The `migrate.py` commands below already work.

Some updates change the file format inside your project folders. When that happens, the whole
screen blurs the next time you open the app, and an `Updating dira` window sits on top. Nothing
is broken. dira is moving each registered project to the new format one at a time, and the window
closes by itself when it is done. Leave it alone until then. While it runs, no worker in any
project picks up a new ticket.

The window has one row per project. A grey dot means the project is waiting its turn, a spinner
shows the item being applied right now, and a check mark means it is done. If a row says
`Waiting for {n} running sessions to finish`, that project still has sessions running. dira does
not cut them off; it waits for them to end and then moves the project. After 20 minutes two buttons
appear. Press `Wait 20 more minutes` if the sessions look close to done, or `Skip this project` to
deal with it later.

**If a row fails**, it shows a one-line cause, the log path and the backup path. The failed project
has already been put back the way it was before, and the other projects carry on. If the cause is
something you can fix (a full disk, say), fix it and press `Retry`. If you cannot tell what went
wrong, or do not want to spend the time now, press `Skip this project`. A skipped project's row
reads `Skipped - this project will not dispatch`, and nobody picks up its tickets until you apply it.
The other projects run as usual.

**Backups** stay in each project under
`<project>/.dira/migrations/backup/<item ID>/<time>/`. The files from before the change are there
as they were, not zipped, at the same paths they had inside the project. dira never deletes this
folder, so remove it yourself once you no longer need it. What was done is written one line at a
time, with timestamps, in `<project>/.dira/migrations/migrate.log`.

**To apply a skipped project later**, run the following in a terminal. The engine inside the app
lives in `~/Library/Application Support/dira/engine/`. `<root>` is that project's `.dira` folder.

```bash
cd ~/Library/Application\ Support/dira/engine
python3 migrate.py list --root <root>                # find the item IDs left as skipped
python3 migrate.py apply --root <root> --id <item ID>  # apply that item
```

If several items were skipped, run it once per ID. `apply` without `--id` leaves skipped items as
they are. Once every remaining item is applied, that project dispatches again. The full command
list is in [CLI](/docs/ref-cli#migrate-py-project-migration).

## Running the engine without the app

For when you do not need the screen, or you are running on Linux. This route clones the repo
directly.

```bash
git clone https://github.com/proofer-tech/dira.git ~/Projects/dira
```

Writing the worker file by hand and putting it on cron is in the appendix,
[Running the engine alone](/docs/cron). Using the app alongside it is fine. The app carries its
own copy of the engine inside the bundle. As long as both are looking at the same queue root
(`<project>/.dira`), they can tend one project without ever knowing about each other.

Next is [Create your first project](/docs/first-ticket).
