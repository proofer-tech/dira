# Closing

That is the main line of the manual. The four chapters after this one are not written to be read
in order. They are reference you open when you need them.

## What you can do once you have read it

[Install](/docs/install) is downloading one `.dmg`, and
[Create your first project](/docs/first-ticket) is picking a folder. That single pass puts up the
skeleton of the queue, one worker, and the crontab entry together. Once a project is up, one
action is left. Put what you want into the field on
[Submitting a request](/docs/requirements) as a sentence, and within a minute pm breaks that
request into several tickets.

After that you watch. The three lanes on the board, the ticket detail, and what a running session
is doing right now are in [The screens](/docs/screens). If a session is heading the wrong way, you
do not have to wait for its turn to end - [you can talk to it](/docs/barge-in). When you already
know what to ask for, skip pm and [write the ticket yourself](/docs/ticket-writing). Which file
that ticket is at any moment, and where it goes next, is what
[The states a ticket passes through](/docs/states) answers.

The handle for scaling up is [Workers](/docs/worker). Make one more and that many more sessions
run at once ([How many to run at once](/docs/concurrency)). What role a worker works in is decided
by [Personas](/docs/personas), and the rules everybody reads together are written in
[Protocols](/docs/protocols). Finished work becomes knowledge the next session can look up in
[Archiving and the ontology](/docs/ontology). When tickets sit open and the sessions stay quiet,
it is usually [Authentication](/docs/auth).

## The four appendix chapters

- [Running the engine alone](/docs/cron) - the branch where the engine runs without the app. You
  write the worker file by hand and put it on crontab yourself.
- [Worker environment variables](/docs/ref-env) - the table of values a worker file can override.
- [CLI](/docs/ref-cli) - the commands the worker script and `tickets.py` take.
- [frontmatter fields](/docs/ref-frontmatter) - the fields written at the top of a ticket file.

## When you are stuck

[Troubleshooting](/docs/troubleshooting) starts from the symptom. Pick the thing you can actually
see from its contents - `A ticket is not on the board` · `It is Open and nobody claims it` - and it
walks down to the cause. When the screens do not answer,
[Reading the logs](/docs/logs) comes next.

## Send feedback

Whatever got in your way, and whatever you wish worked differently, goes straight from the app.
It is `Help` > `Send feedback` on the menu bar.

There is one field. The first line you write becomes the issue title. Press
`Open a GitHub issue` and GitHub's new-issue screen opens with the body already filled in; the
last press is yours. Two lines ride along in the issue, the version and the session. Both sit in
the form where you can see them before you press anything.

Next is [Running the engine alone](/docs/cron).
