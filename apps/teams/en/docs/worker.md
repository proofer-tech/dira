# Workers

**A worker is a shell script that wakes up every 30 seconds, scans the queue, takes one open
ticket, and starts a session.** One file is one worker (`<root>/workers/<name>.sh`), and `w1` is
already there when you create your first project.

There are two kinds. A **project worker** runs inside this project only, and the file rule just
described is that worker. A **common worker** is a slot you create once on the machine and
several projects take turns using; in the table of a project that borrows it, it appears as a row
with a `Common` badge (see §Common workers - slots that move between projects below).

## The workers screen - what one row tells you

![Eight workers all standing at running, each holding one ticket hash. Next to the title is 165M tokens over the last five hours, and the right end of each row is four actions: reap, stream, stop, delete.](/shots/03-workers.png)

`Workers` in the left nav. One row is one worker, and that row alone tells you what is going on
right now. The columns, left to right, are `Name` · `Status` · `Holding` · `Context` ·
`Last activity` · `pid` · `Tokens (5h)` · `Actions`.

- **Status** is one of four. `running` means a session has been started and the worker is waiting
  for it to finish. `idle` means the worker is on cron and is holding nothing at the moment.
  `stopped` means it is out of crontab and never wakes up at all (`not in the crontab` sits next to
  the badge - a common worker row does not get that phrase), and `stale` means the session
  process died and only the claim is left behind.
- **Holding** is the hash of the ticket it has right now. Press it to go to that ticket in
  detail.
- **Context** is the number of reference documents this worker sends along with every session.
  Press the number and the row expands so you can edit the entries right there. The list every
  worker gets is not in the table. Press `Worker settings` at the top right and the first section
  is `Common context`; a line you put there goes to the top of every worker's own list.
- **Last activity** is the last line `runner.log` printed under this worker's name, verbatim.
  `DISPATCH` means it just handed a ticket to a session. `SKIP` means it woke up, found the
  previous session still going, and went back. Press it and the last 20 lines expand.
- **pid** is the number of the process running that worker right now. `running` and `stale` are
  told apart by whether that number is alive ([The screens](/docs/screens) §Workers).
- **Tokens (5h)** is the tokens used by sessions that finished in the last five hours. The limit
  is attached to one account rather than to each worker, so this column shows you who has been
  drinking how much out of the one tank.

The `Worker settings` dialog has four sections. The first is the `Common context` above, and the
second, `Borrow common workers`, is covered further down under common workers. The third,
`The rest of the worker settings (read-only)`, shows five values: the persona, protocol, and
ontology directories, and the in-progress and done suffixes, as they are actually set for this
project right now. Where workers disagree, it writes them out side by side. To change them, edit the
worker file by hand ([Worker environment variables](/docs/ref-env)).

The last section is `Stale collection`. It holds one `reap` button, and pressing it puts any
ticket left in progress whose session has died back into `Open`. It is a button for doing right now
what a worker does on its own every 30 seconds. `reap` scans **the whole queue**, not one
worker, which is why there is one button no matter how many workers are in the table. The output
appears inside that section, and if there is nothing to collect you get the single line
`No stale tickets to collect.` A project with no workers has no `Worker settings` at all, so it
has no such button either.

## The 30-second cycle - a script that wakes up and dies

A worker is not a process that stays up. Cron runs that script from the top once every
30 seconds, and the script dies when it has done its work. With no ticket to take, it scans the
queue, ends on the spot, and leaves nothing in the log.

So `idle` does not mean "waiting its turn." It means **there is no process for that worker at
this moment**, and a new one appears at the next :00 or :30. Those 30 seconds come from the two
lines that go into crontab (see §Five things that come with a new worker below). That is also
why there is no field on screen to tune it.

It runs whether the app is there or not. Close the app and tickets keep being processed; leave
it open and nothing goes faster. In the other direction, take the crontab line out with `Stop`
and that worker never wakes again, app or no app.

## Workers and sessions - one ticket at a time

The next thing a worker does after claiming a ticket is start a session. A session is the agent
process that carries that ticket (`claude -p` by default), and it gets a prompt made of the
persona profile and the collaboration protocol with the ticket it claimed appended. The session
reads the ticket body itself, on the spot. **The worker waits in the same place until that
session ends.** A ticket that takes 30 minutes means it waits 30 minutes.

Cron still calls that worker every 30 seconds while it waits. The new one sees that the previous
run is still working, leaves one `SKIP` line, and backs off. That is why no worker ever starts
two sessions and no ticket is ever dispatched twice. The device that holds that spot, and how it
connects to the number of workers, is in [How many to run at once](/docs/concurrency)
§The worker lock.

Workers finish fast and sessions run long. A `running` that has been up for a while means the
session that worker started is still working. If you have something to say to that session right
now, go to [Talking to a running session](/docs/barge-in).

## Taking a ticket - renaming one file

"Take" is not a metaphor. What a worker actually does once it has picked a candidate is one
thing: turn `<hash>.md` into `<hash>.wip.md`. If that works the ticket is this worker's; if
another worker already renamed it, the attempt fails right there and the worker moves to the
next candidate.

This is why several workers can watch the same queue at once and never take the same ticket. The
moment of checking is the moment of claiming, so no other worker fits in between. How a rename
becomes a lock is in [The states a ticket passes through](/docs/states) §Why the filename is the
lock.

A candidate is a ticket that is open and whose prerequisite tickets (`deps`) are all finished.
Among those, higher priority goes first, and ties go to whichever was created earlier. Priority
is `priority:` in the ticket frontmatter, 1 to 5, where 5 is highest. Leave it out and it is 3.

If a ticket is open and still nobody takes it, there are two more gates under priority. Each
persona can have a cap on how many tickets it holds at once, and a priority 1 ticket is a
candidate only while nothing is in progress. Both are in [How many to run at
once](/docs/concurrency) §Three places where fewer run than you have workers.

## Why every worker gets its own tree

Two sessions committing to the same branch in one directory overwrite each other's work. That
actually happened in this project. A new worker inherited the template worker's working
directory value as-is, three sessions ended up committing to one branch in one tree, and the
screen could not even show it as a fault.

So that path is now derived from the worker name. The name is the directory, so a value that
points two workers at the same tree cannot arise in the first place.

If git is not managing the project folder, no tree is created and you are simply told so. The
worker file and the crontab entry are still valid. A setup with one worker does not need a tree.

## One press of `New worker`

One worker takes one ticket at a time. So when the `Open` lane keeps piling up while the
`In progress` lane always holds a single card, that worker has become too few. There are two ways
to add: make another one for this project only (this section), or borrow a common worker (see
§Common workers - slots that move between projects below). How many is right is in [How many to
run at once](/docs/concurrency).

Press `New worker` at the top right and the only thing the dialog asks for is a **name**. Keep it
short, like `w2`. Letters, digits, `_`, and `-` only, and this name becomes the filename and the
working directory name as-is.

There is no field here for the engine or the model. A new worker is made by copying an existing
one, so it inherits the engine setting too. The place to change which CLI starts the session is
in §The persona decides the engine and the model below.

The whole point of this flow is that the success screen has no registration command on it. You
get a sentence saying it was created and
`Registered in the crontab — it starts claiming tickets in 30 seconds.`, and that worker shows up
in the list as `idle` rather than `stopped`. There is no reason to open a shell.

### Five things that come with a new worker

1. **The worker file** `<root>/workers/<name>.sh`. An existing worker is copied as the template
   and left at 755.
2. **Two crontab lines** - `:00` and `:30`. Cron is the built-in macOS facility that runs a
   command for you at times you set, and crontab is that schedule. One worker takes two lines
   because the finest unit cron can handle is the minute.
3. **A git worktree** `<root>/worktrees/<name>` and a branch `wt/<name>`. A branch is a line of
   work split off the same code, and a worktree is that line laid out in its own folder. Think of
   each worker working on its own line inside its own folder.
4. **A `.dira` symlink** - the shortcut inside that worktree that points at the queue. Sessions
   write `.dira/tickets/…` as a relative path, so without it a worker cannot find its own ticket.
5. **Verification.** It follows that symlink back to check that it resolves to this project's
   queue. It does not stop at seeing that a link is there.

It does not install dependencies (nothing like `npm install`). That is the ceiling of this
feature. The first time a new worker's working directory takes a frontend ticket, there is no
`node_modules`. The command differs per project, so the app has no way to know it.

## The three buttons at the right of a row

Every row carries `Stream` · `Stop` (or `Re-register`) · `Delete`. The `reap` that used to sit
with them is now in `Stale collection`, the last section of the `Worker settings` dialog at the top
right. It is an operation that scans the whole queue, so it gives the same result from any row,
and there is no reason to keep one per row.

- **Stream** opens the `Progress record` of the running session. It opens only when the worker is
  `running` and the ticket it holds is known, and interjecting happens inside it ([Talking to a
  running session](/docs/barge-in)). On rows where it cannot open, the button is not removed; it
  stays dimmed. Only `claude` and `grok` leave a progress record, so a session running on `codex`
  or `agy` never opens this button, and interjecting works on `claude` only. That is not a fault,
  just a different feature set, and the ticket gets done the same way.

The other three touch different things.

| Button | What it does | What is left |
|---|---|---|
| `Stop` | Takes that worker's line out of crontab | The file and the working directory stay |
| `Re-register` | Puts the crontab line back | The exact reverse of `Stop`, and nothing more |
| `Delete` | Takes the crontab line out, then deletes the file | Not one ticket is deleted |

- `Stop` and `Re-register` share a spot and never appear together. Crontab decides which one,
  not the state. A line to remove means `Stop`; none means `Re-register`.
- `Stop` does not kill a running session. If a ticket is being held, it tells you it will halt
  once that ticket is finished.
- `Delete` has a fixed order: crontab first, file second. Reverse it and cron runs a file that is
  not there during that one minute, piling errors into the log. If the crontab removal fails, it
  stops without deleting the file.
- A `running` worker cannot be deleted. The running session and the claim it holds would be left
  hanging. Stop it first, and delete it once the ticket it holds is finished.

## Common workers - slots that move between projects

As projects multiply, so does the work of making and minding workers, one set per project. A
common worker gathers that into one place. You create workers once on the machine, and each
project only decides how many it will borrow.

**One common worker is one concurrently running session.** It is the same unit as a project
worker, and it is not cloned. That slot holds one project at a time and lets go when the ticket
it held is finished. The next round it may go to a different project.

### Where you make them - `Settings` › `Workers`

Open `Settings` with the gear at the far right of the header and pick `Workers`, at the bottom of
the `Setting categories` group in the left tree. The top of the panel is three filters, and the
first section under them is `Common worker pool`. Press `Create worker` on the right and the only
thing to decide is a name; the rule is the same as for a project worker, so letters, digits, `_`,
and `-` only. Saving finishes crontab registration in the same go, so that row comes up `idle`
right away.

While the pool is empty, the list reads
`No common workers — creating one adds it to every project that borrows.`

Once you have made one, that row in the list tells you four things.

| Place | What |
|---|---|
| Name | The name of that common worker, and its filename |
| State badge | The same four as a project worker (`running` · `idle` · `stopped` · `stale`) |
| `<n> projects` | How many projects are borrowing from this pool right now. `0 projects` is a slot nobody borrows |
| `Stop` / `Register` · `Delete` | The same three as in the worker table |

**This panel is the only place the pool is operated from.** `Delete` refuses while that slot
holds a project, and names the project and the pid as the reason. Press it again once the session
has ended.

The section below, `All workers`, gathers the workers of every registered project into one place.
Rows are grouped per project with the worker count on the right, and a project that has lost its
connection is not dropped from the list but shown with the reason. The three filters at the top,
`Project` · `Kind` · `Status`, narrow both sections together, and `Clear filters` puts them back.
This panel reads once, when you open the dialog. It does not refresh while it is open, so close
it and open it again.

### Where you borrow them - the project's `Worker settings`

Whether to borrow is decided per project. Press `Worker settings` at the top right of the workers
screen and the second section is `Borrow common workers`. Press the value next to `Limit` and a
popover opens; put a number into `Concurrent borrow limit` and press `Save`. If you have never
set one, the value reads `None`.

This one line sits under that popover.

> `0 or empty means no borrowing — the limit is how many run at once, not a reservation.`

**The number you put here means "at most this many."** Write that you will borrow up to 3 and
this project is still using 0 common workers at any moment when the pool is empty or other
projects hold the slots. Nor, in the other direction, are those 3 sitting idle for this project.

Save `1` or more and every common worker appears in this project's worker table. The line under
the section becomes `<n> common worker(s) are in this project`, and with none it reads
`No common workers are in this project`. Set it back to `0` and they all leave. A slot holding a
ticket at that moment cannot be pulled, and its name is listed after
`Still holding a ticket, couldn't remove: `.

Three things can keep a save from doing what you meant.

- **A name collision is refused.** A common worker cannot go into a queue that already has a
  project worker of the same name. It would overwrite that worker file, and the reason names it
  outright.
- **A value it cannot read is read as no borrowing.** In that case
  `Couldn't read pool-limit — reading it as not borrowing.` appears under the limit.
- **After creating a new common worker, save the limit once more in every project that borrows.**
  Adding a worker to the pool does not grow the table of a project that is already borrowing on
  its own. Save the same value again and it joins on the spot.

### How to spot one in the table

A borrowed common worker appears as one row in the worker table. The one mark that tells it from
a project worker is the `Common` badge next to `Name`, and pressing that badge opens the
`Workers` node of `Settings` directly.

| | Project worker | Common worker |
|---|---|---|
| Where you make it | `New worker` at the top right of the workers screen | `New worker` in `Settings` › `Workers` |
| Queue it runs | This one project | One at a time, taking turns across the projects with borrowing on |
| Worktree | Created along with it | Created the first time it takes a ticket in this queue |
| Common context, integration gate, account rules | It gets this project's | The same - it gets those of whichever project it took |
| Engine and model | The ticket's persona decides | The same. So one slot can run on a different engine per project |
| `Stream` on the row | You press it | You press it just the same |
| `Stop` · `Re-register` · `Delete` on the row | You press them | Dimmed and blocked |

That last row is blocked because those three act on the whole pool. Stopping from this project
could never halt a slot that is running in another one. So the controls were left in the one
place, over in `Settings`.

It is the same reason a common worker row at `stopped` does not get `not in the crontab`. A common
worker's cron line is in the pool, not in this project's file, so the `Re-register` that phrase
points at is a blocked operation on this row. The `Common` badge in the same row tells you why
instead.

### The rule that decides whose turn it is

A common worker that has woken up picks its project in four steps.

1. Only projects with a borrow limit of `1` or more are candidates.
2. Drop any project whose current count of held common workers has reached its own limit.
3. Drop any project with no open tickets at all.
4. Among what is left, pick the project that has **gone longest without being taken**.

Step 4 is why one project cannot monopolize the pool. Priorities are never compared across
projects. `priority` means something only inside one queue, and picking a project is a matter of
turn-taking. Inside the queue, which ticket gets taken first does not differ by a single
character from a project worker.

If the project it picked turns out to offer no ticket, that round ends quietly and the next round
picks the next candidate 30 seconds later. A running session is never cut short to move to a more
urgent project.

## The persona decides the engine and the model

There is no `Engine` column in the worker table. Which CLI starts the session is decided by that
ticket's `persona:`, and the place to change it is [Personas](/docs/personas) §Dispatch policy.
Press the `Engine` value and you pick one of `claude` · `codex` · `grok` · `agy` and a model
within it. A model name not on the list goes in through `Type one in…`. Leave it at `Not set` and
it uses the engine of whichever worker took the ticket.

`Limit` in the same section is how many in-progress tickets that persona may hold at once. Add
workers and that one persona still does not go past that number.

## When it breaks partway - copy just the commands that are left

Writing to crontab can be blocked by the `App Management` approval on macOS, and a worktree can
be blocked by a name collision or by permissions. The app still does not roll back. It shows you
where it got to and why, right there, and gives you just the remaining commands behind a copy
button. Re-running a step that already finished is how you walk into a trap.

Those commands are not written down in this document for the same reason. On success you never
see them, and the failure screen fills in the exact paths of that moment for you.

---

The procedure for making a worker by hand and putting it on cron yourself, without the app, is in
the appendix [Running the engine alone](/docs/cron).

Next is [How many to run at once](/docs/concurrency).
