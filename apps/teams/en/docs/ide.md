# Terminal, files, and source control

There comes a point where you want to open the file a worker changed and look at it yourself.
Running the tests once, or checking the commits a worker has piled up and taking them to the
integration branch, is the same kind of thing. None of it means leaving for another app.

Press the logo in the header and you are home. Five icons sit in a row at the top of the
left-hand panel.

## The five surfaces

`Home agent` · `Schedules` · `Terminal` · `Source control` · `Explorer`. These five are the
surfaces. The row carries icons only, with no names written out, so if you cannot tell which
icon is which surface, hover over it. The name comes up as a tooltip. Those are the names this
chapter uses below. The first time you open it, `Home agent` is the one picked, and below it are
two groups: `Conversations` and `Worker sessions`.

Changing surfaces does not change the address. The screen list on the header stays where it is.
What changes is the lower half of the left-hand panel and the column on the right, and nothing
else.

| Surface picked | Lower half of the left panel | The column on the right |
|---|---|---|
| `Home agent` | `Conversations` · `Worker sessions` | The conversation tab strip and the thread |
| `Schedules` | The schedule list and the way in to `New schedule` | The conversation thread of the schedule you picked |
| `Terminal` | Nothing | The `Working directory` picker, the terminal tab strip, and the shell |
| `Source control` | The root and the worktrees, and `git status` for whichever one you picked | The conversation tab strip and thread, unchanged |
| `Explorer` | The file tree and find | The one file you have open |

What you do on the `Schedules` surface is covered in a chapter of its own,
[Schedules](/docs/schedules). What is left for this one is the other four.

Two things become tabs: conversations and terminals. A file you open in the explorer does not go
into a tab, so only one is up at a time. Twelve tabs open in all. Past that, the one you have
looked at least recently closes on its own.

Refresh the browser, or leave a surface and come back, and the terminal tab reads
`Terminal disconnected`. The shell is only in memory for as long as the app runs, so redrawing
the screen breaks the connection. Press `Reopen` and a new shell comes up in the same directory.
What you typed before, and what it printed, do not come back.

## The home agent's persona

One `Persona` select sits at the top of the conversation column. Every persona in this project
that has a profile shows up in it. It starts on `archive-manager`. Pick pm and ask, and the
answer comes back with pm's profile loaded. The [Personas](/docs/personas) chapter covers what
that profile is.

- **One run in and the select locks.** When two personas speak in one conversation, nobody can
  work out later what any given answer was based on. To ask as a different persona, press
  `New conversation`.
- The schedule dialog has the same field. What wakes at the time you set is the home agent, so
  which one to wake is written on that row too (see [Schedules](/docs/schedules)).

**Changing the persona does not widen what it may do.** Pick developer and it still cannot edit
under `apps/`; pick pm and it still cannot commit or push from here. The tools the home agent
carries, and the places its writing reaches, are one set whichever name you picked (see
[The screens](/docs/screens)). The only thing that changes is the one profile that goes into the
prompt.

Work that needs wider permission goes out as a ticket. Once a worker takes that ticket, it
carries the full set of tools. You can ask in the home conversation to have it filed as a
request, or file it from the board yourself (see
[Writing a ticket yourself](/docs/ticket-writing)).

## The terminal

Pick `Terminal` and a `Working directory` select and a `New terminal` button appear at the top
right.

1. In `Working directory`, pick where the shell should start. The project root and every
   worker's worktree are all in the list.
2. Press `New terminal`. A tab opens and a prompt is drawn.
3. Type your command. Colored output comes through as it is, and programs that draw the whole
   screen, like `vim` or `top`, run too.

The working directory is set when the tab is made and does not change after that. To move, type
`cd` yourself. The shell is the one you normally use on this Mac. The app does not pick one for
you.

There is no allowlist on commands. Anything you can type in a terminal app you can type here.
Eight open at once. Try for a ninth and `Up to 8 terminals can be open at once.` comes up. Close
a tab and that shell ends with it.

**Nothing here stops you from editing an in-progress ticket.** The app not giving you a place to
edit, and a person opening `vim` on their own Mac, are two different things. What stays true is
that a session is working on that file right now, so read
[The exception - in-progress tickets](#the-exception-in-progress-tickets) below first.

## The explorer

Pick `Explorer` and the left-hand panel becomes the file tree of the project root.

- Press a directory and it reads that one level. Even in a large repository the first draw does
  not take long.
- It opens with `Show hidden files` on. That is because `.dira`, which holds the queue, is
  inside one. Turn it off and names starting with a dot drop out of the tree.
- It draws up to 2,000 entries per directory. Past that, one line in that spot says how many of
  them it drew.
- It goes down into worktrees as well. What it will not expand is a spot pointing back at a
  directory already open above it, like the `.dira` inside a worktree, and it tells you why.
  Otherwise the app digs into the same place forever.

Press a file and it comes up in the right-hand column with coloring on it. Edit it, press
`Save`, and the file on disk changes. Saving writes a temporary file and then renames it. A
session reading that file never catches it half-written.

The editor does three things: it opens, it edits, it saves. There is no autocomplete and no
formatter.

### Files it will not open

- **Files over 1MB, and files that are not text, do not open.** You get the reason and one
  `Open with default app` button. macOS hands the file to whatever app knows it.
- **The editor does not open the markdown of tickets, personas, or protocols.** Press one and
  you go to the screen that already handles that file. This is so that no place exists where the
  same file is open in two editors.
- **A file someone else changed after you read it does not get overwritten.** Just before
  saving, it measures the file again, and if it has changed it does not write, and tells you.
  Workers run in this repository by the handful, so this comes up more often than you would
  think. Open it again, check, then save.

### The exception - in-progress tickets

An in-progress ticket file cannot be edited on any screen. Press it in the explorer and the
editor does not open; you go to the ticket page, where it says
`A session holds this ticket — editing and deleting are locked`.

That is because a session is working on that file right now. All the while it works, it ticks
the checkboxes in that file and writes `## 결과` (the result section). If a person overwrites the
same file at the same time, one of the two disappears without a word. When you have to change
it, press `Unassign` on the ticket page to put it back in the queue, then change it (see
[The states a ticket passes through](/docs/states)). And if it really has to be touched right
now, the way in through a terminal tab is not closed off.

## Finding files

Two tabs sit at the top of the explorer's left panel: `Tree` and `Find in files`.

**Finding by name** is the field at the top of the `Tree` tab. As you type, the tree filters
down to files whose names hold what you typed. It sweeps once under the project folder to build
a list of names, leaving out `.git`, `node_modules`, and `.next`. Past 50,000 names it cuts
there and tells you to narrow it down.

**Finding by content** is the `Find in files` tab. Type in the field, press `Find`, and lines
holding those characters come up with the file name and the line number. Press a result row and
that file opens at that line. Results stop at 200 lines, and the search stops at 10 seconds. If
it was cut, that fact attaches as one line under the list, so narrow the search and run it
again.

Both finds **leave worktree copies out by default.** With eight workers, the same file exists in
nine copies and the results come back nine times over. Turn on `Include worktree copies` and
those copies come in too.

## Source control

Pick `Source control` and the left panel fills with every working folder in this project. `Root`
at the top, `Worktrees n` below. The root is the project folder itself, and a worktree is one
copy split off per worker (see [Workers](/docs/worker)). In a project that does not use
worktrees, only the `Root` row shows.

Pick one and what sits under it fills in.

- The branch name and `Ahead n` · `Behind n`. That is how many commits ahead of and behind the
  upstream it is.
- The upstream select. The current value is written there, and you change it by picking from the
  list of remote branches. If there is none yet it reads `No upstream`.
- A `Stage all` button and two lists, `Staged n` and `Working tree n`. Press a row and it moves
  between the two lists. In front of the file name goes `Modified` · `New` · `Deleted` ·
  `Renamed`.
- The commit message field and `Commit`. You cannot press it while the staged list is empty or
  the message is empty.
- `Push` and `Pull`.

**The app does not re-read this surface on its own.** It reads the moment you open the surface,
when you press `Refresh`, and right after a commit, a push, or a pull. Leave it open and walk
away and no new `git` process starts. If a worker committed in the meantime, you have to press
`Refresh` to see it.

Nothing is attached to a commit message automatically. The `Ticket:` line at the bottom of a
worker's commits is put there by the worker as it wraps up. A commit a person makes here does
not hang off a ticket.

### Where Push goes

There is no field to choose. Which working folder you have picked is where it goes.

| What you picked | Where `Push` goes |
|---|---|
| A worktree | The integration branch on this Mac |
| The root | `origin` |

Pushing from a worktree takes the same path the workers take. So that eight of them pushing at
once do not collide, `push.sh` in the queue puts them in order (see [Workers](/docs/worker)). In
a project without that file, `This project has no push.sh` sits where the button would be. The
app does not write one in for you.

`Pull` only pulls when it can attach straight on. It makes no merge commit and no rebase. When
the state does not allow that, it shows you the reason `git` gave, verbatim, and stops there.
From there it is a terminal tab and your own hands.

## What is not here

- There is no diff viewer. Press a file row and it opens in the editor.
- There is no merge, no rebase, no branch creation, no tags.
- There are no `push --force`, `reset --hard`, or `stash` buttons. The commands that undo things
  are left to people.
- There is no autocomplete, no formatter, no debugger. Running things is the terminal tab's job.
- It opens no remote server and no container. What it opens is the one folder of the project you
  registered.

If you need something that is not here, type it in a terminal tab. The app does not narrow what
a person can do on their own Mac.

Next is [Writing a ticket yourself](/docs/ticket-writing).
