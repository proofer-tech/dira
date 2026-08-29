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

`python3` and `bash` already ship with macOS. The engine uses nothing but the standard library
of those two, so there is no package to install.

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
