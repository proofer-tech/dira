# Usage analytics, and how to turn them off

The app (`dira teams`) sends usage analytics to GA4, and when something goes wrong in the app it
reports the error to the dira server. One switch turns both on and off together. The engine
(`tick.sh`, `tickets.py`) sends nothing at all. Everything in this chapter is about the app side.

## What gets sent - eight events

Eight names, and that is all of them. An event in the code that is not in this table is a defect.

| Event | When | Parameters |
|---|---|---|
| `app_open` | a user session starts (ahead of the first event, and again after 30 minutes of no activity) | `app_version`, `shell` (`desktop`\|`browser`) |
| `screen_view` | you arrive on a screen | `screen` (`root`\|`board`\|`ticket`\|`workers`\|`personas`\|`protocols`\|`ontology`\|`home`) |
| `project_add` | a project has been added | `method` (`create`\|`register`) |
| `worker_create` | a worker was created | `engine` (the id from the engine catalogue as it stands. Today that is `claude`\|`codex`\|`grok`\|`agy`, and a value typed by hand folds into `other`), `cron_ok` (bool) |
| `ticket_create` | a ticket was issued or a request submitted | `kind` (`work`\|`request`\|`feedback`) |
| `answer_submit` | a person wrote the answer in an answer round trip | none |
| `feedback_submit` | send was pressed on the feedback form | none |
| `analytics_off` | analytics are turned off (one last time, just before it stops) | none |

The values are counts, booleans and enums decided in advance, and nothing else. Facts the engine
makes, like a `.done` transition or a dispatch, are not events. Only screen actions are counted.
Errors are not counted as events in this table. They go out as a separate request, described
under Error reports below.

## What does not get sent

None of the following goes into any parameter of any event.

File paths, project names, the queue root, ticket hashes, ticket titles, ticket bodies, persona
names, worker names, people's names, tokens, prompts (the instructions that go into an agent, or
what the agent puts out), and anything an IP could be inferred from.

`screen_view` does not send the URL itself either. `/p/<project>/tickets/<hash>` carries both a
project name and a ticket hash, so what goes out is that path swapped for one screen name decided
in advance (`ticket`, and so on). The free text you write in the feedback form does not reach GA
either. That goes to a GitHub issue and nowhere else, and what is left in GA is the fact that you
sent it (`feedback_submit`).

This list is a promise about the events that go to GA. Error reports carry the raw logs as they
are, so the promise does not cover them. What can end up in them is set out right below.

## Error reports

While usage analytics is on, an error in the app is sent to the dira server (the same Vercel
project as the website), stack trace and raw logs included. We need to see errors to fix them,
and that is why this exists. Errors are caught in three places: the app server running on your
Mac, the screen (the renderer), and the desktop app itself.

One report is a single JSON object of at most 256 KB. These keys are all it holds.

| Key | Value |
|---|---|
| `v` | Format version. `1` for now |
| `install_id`, `session_id` | The same install and session identifiers sent to GA, so a report and that install's usage analytics share the same value |
| `app_version`, `shell` | The same values `app_open` carries |
| `source` | Where the error happened. `server`\|`renderer`\|`main` |
| `kind` | What kind of error. `uncaught`\|`unhandled_rejection`\|`request_error`\|`boundary`\|`child_exit`\|`renderer_gone`\|`ready_timeout` |
| `message` | The error message, verbatim |
| `stack` | The stack trace, verbatim |
| `raw` | The raw log leading up to the error. For the app server, the last 200 lines of stderr and stdout. For the desktop app, everything the app server wrote to stderr plus the tail of its stdout. For the screen, the last 50 console errors. Past 64 KB the front is cut off |
| `route` | The route pattern of the screen where it happened (`/p/[project]/tickets/[hash]`). The actual URL is not sent |
| `at` | When it happened (ISO 8601) |

Only one thing is changed before sending. In every string, the absolute path of your home
directory becomes `~`, so `/Users/<your name>/Projects/app/.dira` goes out as
`~/Projects/app/.dira`. Everything else is left as it was. That means the stack and the raw log
can contain file paths under your home, project names, ticket hashes, and whatever lines were in
the log when the error hit. If you would rather not send that, turn usage analytics off.

The app batches reports so a repeating error does not flood the server. The same error goes out
at most once every 10 minutes, and one install sends at most 20 reports an hour. A report that
fails to send is dropped, not retried.

The server stores each report it receives privately on Vercel, one file per report, and keeps it
for 90 days.

## What has to be true to send - two credentials

Nothing goes out without `GA_MEASUREMENT_ID` and `GA_API_SECRET`. CI puts those two into release
builds only, and they are not committed to the repository. **With no values, the code sends
nothing.** A development server started with `pnpm dev` and an `.app` you built by hand are both
in that state. That is why sessions running during development do not pollute the analytics. Error reports
follow the same rule, so an error in a development build goes nowhere.

`Usage stats` in the `Settings` dialog shows you whether those values are there, too. On a build
without the credentials you get the one line `Not sending` and the reason, and no button to turn
anything off. There is nothing to turn off.

## Turning it off

Open `Settings` with the gear at the top right and pick `Usage stats` in the left-hand tree (see
[The screens](/docs/screens)). It is on by default, and one button turns it off. From that
moment no event goes out, and the line above changes to `Not sending`. Error reports stop at the
same moment. There is no separate switch for error reports alone.

## Deleting it

There is one analytics file, `~/.config/dira/analytics.json`. It holds two values and no more:
`install_id` (the anonymous install identifier, sent to GA4 as the `client_id` and as the
user property `install_id`) and `enabled` (written as `false` only when you have turned it
off). Delete the file and the next run issues a new `install_id`, counted as a new install with
no line back to the earlier analytics. One line in a terminal does it.

```bash
rm ~/.config/dira/analytics.json
```

Deleting the file does not delete error reports already sent. Those stay on the server until the
90-day retention period runs out.

What is sent and why, how long it is kept, and who processes it are in the [privacy
policy](/privacy).

Next is [Commands](/docs/schedules).
