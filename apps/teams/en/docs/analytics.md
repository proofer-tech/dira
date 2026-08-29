# Usage analytics, and how to turn them off

The app (`dira teams`) sends usage analytics to GA4. The engine (`tick.sh`, `tickets.py`) sends
nothing at all. Everything in this chapter is about the app side.

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
Errors and crashes are not sent either.

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

## What has to be true to send - two credentials

Nothing goes out without `GA_MEASUREMENT_ID` and `GA_API_SECRET`. CI puts those two into release
builds only, and they are not committed to the repository. **With no values, the code sends
nothing.** A development server started with `pnpm dev` and an `.app` you built by hand are both
in that state. That is why sessions running during development do not pollute the analytics.

`Usage stats` in the `Settings` dialog shows you whether those values are there, too. On a build
without the credentials you get the one line `Not sending` and the reason, and no button to turn
anything off. There is nothing to turn off.

## Turning it off

Open `Settings` with the gear at the top right and pick `Usage stats` in the left-hand tree (see
[The screens](/docs/screens)). It is on by default, and one button turns it off. From that
moment no event goes out, and the line above changes to `Not sending`.

## Deleting it

There is one analytics file, `~/.config/dira/analytics.json`. It holds two values and no more:
`install_id` (the anonymous install identifier sent to GA4) and `enabled` (written as `false`
only when you have turned it off). Delete the file and the next run issues a new `install_id`,
counted as a new install with no line back to the earlier analytics. One line in a terminal does
it.

```bash
rm ~/.config/dira/analytics.json
```

What is sent and why, how long it is kept, and who processes it are in the [privacy
policy](/privacy).

Next is [Schedules](/docs/schedules).
