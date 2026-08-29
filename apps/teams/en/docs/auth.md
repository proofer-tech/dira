# Authentication

The long-lived token workers use is for Claude only. A worker whose engine is another CLI, like
`codex`, never even looks at the token file and uses its own authentication. Which worker runs on
which engine is decided by the persona ([Workers](/docs/worker) §The persona decides the engine
and the model).

## Authenticating in the browser

Press the gear at the far right of the header and `Settings` opens. `Authentication` › `claude`
in the left tree is this chapter's screen. From the top down, it looks like this.

1. **What you need** - the path of the executable the app found, after `claude CLI —`. If it did
   not find one, `claude CLI not found — workers cannot start sessions`.
2. **Accounts** - registered tokens, one per line. A name you can recognize, a state badge, the
   value masked except for its head and tail, and `Added <date>` make up one row. Rename with the
   pencil on the right, delete with the trash can. With nothing entered yet, there is only the
   line `No tokens yet.`
3. **The `Add` button** - one button under the list. With a token already there, the label becomes
   `Change`. Press it and issuing a token and entering one by hand open together in one popover.

If the first line says it did not find one, the rest is no use. Getting a token and opening a
session when a worker takes a ticket are both jobs for that executable. If it is installed and
still not found, quit the app and open it again. If that leaves it as it was, go back to
[Install](/docs/install).

Press `Authenticate in the browser` at the top of the popover and the app walks through the
official CLI's issuing procedure (`claude setup-token`) for you. There is nothing for you to type
in a terminal. The CLI opens a new tab, and progress appears line by line in the log under the
button.

- When the browser shows you a code, paste that code into the `Code from the browser` field and
  press `Send the code`. Sometimes approval alone finishes it. If that context is already logged
  in and consented at claude.com, it flows through without a code. The field is there for
  answering when you are asked.
- The app stores the token where it belongs. There is nothing for you to copy over, so the
  progress log shows the token masked. The original never lands in a screen share or a
  screenshot.
- Pressing it is already issuing it. If the browser opened, a flow that creates credentials under
  your claude.com account has begun, and there is no place to undo it.
- If it breaks, it shows you the reason verbatim. What the app is doing is reading someone else's
  CLI screen, so it can break when that wording changes. The field below is the floor you land on
  when it does.

The `Token` field at the bottom of the same popover stays there after issuing. Paste a token you
already have and press `Save` and it goes to the same place with the same authority. The token in
use becomes the one you just entered. `Label (optional)` below it is the name you will recognize
in the list. Leave it empty and it gets a number, like `Account 1`.

Validation checks two things only: that it is not empty, and that there is no whitespace or
newline inside the value. Line breaks that came along with the copy are stripped by the app. It
does not filter by prefix format. That format is not ours, and if it changes we would start
rejecting perfectly good tokens. So the screen tells you no more than
`Saved. Whether it is valid shows at the next dispatch.`

## Multiplaying - the switches for keeping several accounts

Before the account list can hold two rows, there is a switch you have to turn on. That panel is
inside the same dialog, but the left tree has no row for it. **You have to type `Multiplaying`
into the search field to find it.** Pick any of the three results and the panel opens. If you
know the name of the switch, `Multiple accounts` brings up the lower two rows as well. Scanning
the tree will never find this panel.

There is one line of explanation at the top of the panel and two switches under it. A switch row
carries the name and its current state, with a button at the right end. The state reads either
`Allowed` or `Not allowed`, and the button is either `Turn on` or `Turn off`.

- **Allow multiple accounts** - decides how many accounts you may register. Off, the list holds
  one row and the button below reads `Change` rather than `Add`. Saving a new token has the app
  swap that one row out. On, the list grows to several rows and each carries `Activate` or
  `Deactivate`. Rows other than the one in use get a `Use` button too. This is when the rotation
  that leaves an account that hit its limit and moves to the next one starts running.
- **Use multiple accounts at once** - decides whether workers share one account or split across
  them. Off, every worker attaches to the one `Active` account. On, a worker's account is its
  index modulo the number of usable accounts. Three accounts and eight workers splits 3-3-2 with
  no worker left idle. In this mode every usable account carries an `Active` badge in the list.

A usable account is a row in the list carrying neither an `Inactive` nor an `Exhausted` badge.
Rows with either of those two drop out of the count, and come back into it once the exhaustion
cooldown lifts. So while you have only one account, turning on using them at once changes
nothing.

The app writes the two switches to different files, so either one can be on by itself. Both apply
separately to the three engines `claude`, `codex`, and `grok`. `agy` is left out because it has
only one account. The story of tokens growing along with your workers is in [How many to run at
once](/docs/concurrency) §Tokens and collisions.

## The notification bell - the first item when there is no token

Before you get to live through "the workers are running and nothing is happening," the screen
tells you first. It comes up as the first item in the notification bell in the project screen
header: `No Claude token` · `Workers will pick up a ticket, fail to open a session, and end
there.` The `Save token` button on that item opens the dialog above, right where you are. There
is no screen to move to.

- On the project screen the gear button itself changes too. `Authentication needed` appears next
  to the icon.
- It does not appear in a project with no claude workers. It does appear if the workers could not
  be read, though. Turning "cannot tell" into "it is fine" would bring back exactly the silence
  this chapter is trying to close.
- There is no button to dismiss it. Put a token in place and the check turns itself off.
- Expiry cannot be announced in advance. The expiry time is not written in the file and the CLI
  does not tell us. What breaks the silence after an expiry instead is the next item in the bell
  (`workers whose sessions die the moment they open`). See [The screens](/docs/screens).

## Cloud mounts - Full Disk Access

This applies only when the queue root is on a mount such as Google Drive. When a process started
by cron tries to read a file in a protected location, macOS **blocks it silently, with no error.**
It looks as though the file is not there.

Open `Settings › Privacy & Security › Full Disk Access`. `cron` itself does not appear in the
list, so press `+`, then `Cmd+Shift+G`, and type `/usr/sbin/cron` in directly to add it. What
actually reads the file is not the worker script but the cron daemon that starts it. It may not
take effect right away even after you turn it on, so run a worker once by hand from the workers
screen and check that the queue is visible.

## `App Management` - the permission it asks for on every worker

Add a worker and the app writes a line to crontab, and macOS asks for the `App Management`
permission at that moment. Registration stops until you answer, and pressing `Allow` carries it
through to the end. The trouble is that this approval does not survive to the next registration.
The same window comes up again every time you make one more worker ([How many to run at
once](/docs/concurrency)). The place to turn it on ahead of time, or to check it, is
`Settings › Privacy & Security › App Management`.

## Without the app - using the engine alone

If you skip the app and run `tick.sh` alone, you have to do by hand what the dialog above does.
What comes out is the same single file. Open a terminal and enter these three lines in order.

```bash
mkdir -p ~/.config/dira
claude setup-token
printf %s '<token>' > ~/.config/dira/oauth-token && chmod 600 ~/.config/dira/oauth-token
```

That is: write the token `claude setup-token` produced into `~/.config/dira/oauth-token` **on one
line with no newline**, and lock it to the owner alone with `chmod 600`. It is the same path the
app saves to, so whichever way you put it in, workers read the same file.

**The token lives on the machine, and there is one of it.** Even with the queue root on a shared
drive, `~/.config/dira` is a place local to this machine that does not sync. That is why moving or
sharing the queue does not spread the secret with it. If you run workers on several machines, you
have to get one on each.

Next is [Troubleshooting](/docs/troubleshooting).
