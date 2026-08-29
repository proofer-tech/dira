# About dira

**A multi-agent management system, easy to run on your own machine.** You hand it a request, pm
splits that request into tickets, a worker for each persona takes one ticket at a time and
starts a session on it, and the result lands on your integration branch. Your part is saying
what you want, and answering when someone asks.

It can burn more tokens than doing the work yourself. Every session assembles its prompt from
scratch, and that prompt runs once per worker, at the same time. Measured sizes are in
[How many to run at once](/docs/concurrency).

dira has no server. Everything, tickets included, happens on the filesystem, and if you open
one of those files and edit it by hand, dira keeps going on what you wrote.

The name is `dir` plus `jira`. The queue is a single directory, hence `dir`, and handling
tickets on top of that directory is the homage to `jira`.

## Four words

Every other chapter assumes you know these four. The screens use the same words.

**A ticket** is one markdown file. It writes down what you want (`## Goal`) and what has to be
true before it counts as finished (`## Done when`).

**The queue** is the single directory those ticket files go in (`<project>/.dira/tickets`).
No subdirectories. State is a filename suffix instead, `.wip` or `.done`, which is what makes
a single rename the lock.

**A worker** is a shell script that wakes every 30 seconds, scans the queue, and takes one open
ticket. One run, one ticket. If you want several running at once, you do not raise a setting.
You make another worker.

**A session** is the agent process the worker starts with that ticket in hand (`claude -p` by
default). The worker assembles the persona profile, the collaboration protocol, and the ticket
body into a prompt, hands it over, and waits until the session ends.

## The app and the engine

The app is the product. Creating a project, submitting a request, watching tickets move,
talking to a running session, adding workers: all of it finishes on screen. You never have to
open a queue file.

The engine is the layer below, and it runs whether or not the app is there. Two files,
`tick.sh` and `tickets.py`, and they never reach past bash and the python3 standard library.
The app does not write its own verdicts into the queue. It delegates them to the engine,
because that is the only way the screen and cron answer the same question the same way. cron
is the scheduler already sitting on your Mac: it runs a command for you on a fixed interval.
Driving dira with cron alone and no screen works too, and
[Running the engine alone](/docs/cron) covers that.

## What stays on your machine

There are no accounts. No login screen, no invite link, no server holding your work. Create a
project and one `.dira` appears under the folder you picked; every ticket and every record a
session leaves piles up inside it. The only person who reads that record is the person at this
machine, so there is nobody to identify.

Moving it and deleting it are both folder work. Move the whole project folder to another disk
and the record comes along. Delete the folder and the record goes with it. There is nowhere to
send a deletion request.

One thing does leave. The session a worker starts sends the ticket body, and whatever code the
job needs, to a model. Calling an agent has always meant that. Which model gets how much is up
to the engine you chose when you made the worker. None of it goes to a dira server, but it
does leave this machine.

The app sends usage analytics to GA4. Ticket bodies and titles, file paths, project names, and
prompts go into no event at all. What it sends, what it holds back, and how to turn it off and
wipe it are in [Usage analytics, and how to turn them off](/docs/analytics).

## What it does not do

- It does not deploy to a server. No hosting, no remote access. The queue exists only on the
  filesystem of the machine you are using.
- No authentication, no multi-user. Filesystem permissions are the permissions.
- The desktop app runs on macOS (Apple Silicon) only. The engine itself runs on macOS and
  Linux.
- Nowhere can you drag the queue into a different order. What runs next is decided by priority
  (1 to 5), the due date, `deps`, and the creation date. `deps` is the field that names the
  tickets which have to finish before this one.

Next is [Install](/docs/install).
