# Schedules

At a time you set, the session wakes up and carries out one sentence you wrote in advance. It is
the same session that answers when you ask at home, the first item on the surface row at the top
left. If the job is sweeping tickets that await an answer every Monday morning, nobody has to be
sitting there at that hour.

**It runs only while this app is open.** Set a time and close the app and nothing happens at that
time.

## Making one

Press the logo in the header and you are home. Five icons sit in a row at the top of the
left-hand panel, and the second from the left is `Schedules`. That row spells no names out, so
hover over an icon if you are not sure which one it is: the name comes up as a tooltip. Press it
and the lower half of the panel becomes the schedule list.

If you have not asked anything yet on this project's home, the left-hand panel is not there at
all, because the first screen is onboarding. Ask anything once and the panel appears, and from
then on it stays.

1. Press `New schedule` to the right of the heading on that lower half. A dialog opens.
2. Pick `Repeat`. It opens on `Once`, and the rest are `Daily`, `Weekly`, `Monthly` and `cron`.
3. Fill in `Time`. The shape of this field changes with the option you picked (see the table
   below). It opens empty, so you have to put a value in.
4. Write what you want done in `Prompt`. It is the same sentence you would type asking at home.
   `Enter` in this field is a line break, not submit.
5. Press `Create`. It becomes pressable once both the time and the prompt are filled in.

The row shows up in the list right away. The upper line is the first line of the prompt and the
lower line is the next scheduled time.

### The five options

| `Repeat` | The `Time` field | When it runs |
|---|---|---|
| `Once` | a date and a time in one field | once, at that time. After it runs it is finished |
| `Daily` | one time | that time every day |
| `Weekly` | one weekday and a time | that time on that weekday |
| `Monthly` | one day from the 1st to the 28th, and a time | that time on that day |
| `cron` | five fields you write by hand | every minute that string matches |

- **`Monthly` stops at the 28th.** From the 29th on there are months without that day. In such a
  month the run would quietly disappear. The screen says so in a line under that field. There is
  no `last day of the month` value.
- Times are read in this computer's time zone. There is no field for picking a zone.
- **No cron string appears in the first four.** Nobody picking Monday at 9 has to write
  `0 9 * * 1` by hand. The screen builds it. If you want to write one yourself, the fifth option
  is that field.
- There is no `every 30 minutes` or `every 3 hours` wording. You write those in the `cron` field
  as well. Every 30 minutes is `*/30 * * * *`.
- **There is nowhere to edit one.** The two operations are making and deleting. To change the
  time or the prompt, delete it and make it again.

### The `cron` field

Write five fields in order: minute, hour, day, month, weekday, separated by spaces.

| Field | The numbers it takes |
|---|---|
| minute | `0` to `59` |
| hour | `0` to `23` |
| day | `1` to `31` |
| month | `1` to `12` |
| weekday | `0` to `6`, where `0` is Sunday |

A field takes four shapes. `*` means every value the field allows. A single integer means that
one value. `1-5` is a range, and a range takes a step too, so `9-18/2` picks every second hour
from 9 to 18. `*/10` is every tenth one. Join those with `,` to put several in one field, as in
`1,3,5`.

- `*/10 9-18 * * 1-5` - every 10 minutes from 9 to 18 on weekdays
- `0 9 * * 1,3,5` - 9 o'clock on Monday, Wednesday and Friday
- `30 2 1 * *` - 2:30 on the 1st of every month

**Four things it does not take.**

- **Names.** `MON` and `JAN` are out. Write weekdays and months as numbers.
- **Macros.** Lines starting with `@daily` or `@hourly` are out.
- **A sixth field.** You cannot put seconds in. The app checks every 15 seconds, so it cannot
  measure anything finer than a minute.
- **Weekday `7`.** Sunday is written `0`, and only `0`.

**Put numbers in both the day and the weekday and it runs only on days where both match.**
`0 9 13 * 5` means 9 o'clock on a 13th that is also a Friday. crontab reads that place as either
one; this does not.

Put a value in the field and a line appears under it. If the syntax is good, that line tells you
**when the next run happens**. If it is wrong, it tells you what is wrong, and `Create` stays
unpressable until you fix it.

**Good syntax does not always mean there is a run.** `0 9 30 2 *` has five valid fields, but
February has no 30th, so it never runs. The screen looks 31 days ahead and says in that line
that there is no run. You can still create it. The row in the list then keeps saying
`No next run`.

## When it runs

- While this app is open. The app checks every 15 seconds and wakes any schedule whose time
  passed in between. No new cron line and no resident daemon come up. This is a different place
  from the automatic run that calls workers ([Running the engine alone](/docs/cron)).
- **Runs missed while the app was closed happen once, late, when you open it.** Turn a 9 o'clock
  daily schedule off for three days and turn it back on, and there is one run. A backlog running
  one after another would burn that project's tokens all at once.
- A late run knows that it is late. Both the scheduled time and the actual time ride along in
  that run's question. A sentence like `tidy up yesterday's` reads those values and judges from
  them.
- Time the Mac spent asleep counts as time the app was closed.

## When it does not run

- Nothing happens while the app is closed. It is settled with one run when you next open it.
- A run more than 31 days past does not happen. The window it looks back over on launch is 31
  days. If you have not opened the app for over a month, anything older than that is treated as
  never having existed. A `Once` time that far past does not run even when you open the app. That
  row stays, with the time on its lower line marked as past. Delete it and make a new one.
- If the previous run is still answering, this run is dropped. Two runs never stack up on one
  thread.
- A conversation a person is having right now has nothing to do with this. A scheduled run and a
  person's question do not wait on each other.

## Where to see the runs

**Pick that schedule's row and the home conversation thread switches to that schedule's.** One
run is one question and one answer. Which tools it called and how many times flows exactly as it
does when a person asked. That thread is the run history. There is no separate list of runs and
no separate execution log.

- **It does not cut into the conversation you were reading.** Each schedule uses a conversation
  of its own. No row appears in the `Conversations` group either. The one way to a run is that
  schedule's row.
- Pick **a schedule that has never run** and you get `No runs yet` and one line saying when the
  first run happens. If it is a `Once` whose time has already passed, a line saying it will not
  run stands there instead. There is no session to talk to yet, so `Send` is locked. If you have
  something to ask, that is what `New conversation` is for.
- Pick **a run in progress** and the text flows and `Stop` appears. Here you can talk to it. What
  you send goes in as an interject ([Talking to a running session](/docs/barge-in)).
- A row that is running gets `Answering` at the right of its upper line.
- **When a run fails, the reason appears in the thread.** It does not run again. There is no
  retry. The next run happens at the next scheduled time.
- There is no notification that a run finished. Nothing appears in the bell either.

## Having it file requests

**It files one only when the sentence told it to.** A run is that same session, so it can
already submit a request ([Submitting a request](/docs/requirements)). Write that into the
schedule's sentence and that sentence is the instruction, written ahead of time.

```
Sweep the tickets awaiting an answer and file a request for anything a human has to answer.
```

What goes up is one `kind: request`, and pm receives it. Whether there is anything to file is for
that run to judge. If it decides there is nothing, it files nothing. A sentence that did not ask
for it submits nothing.

## Deleting

The bin at the far right of the row. `This deletes the schedule` comes up, and the first line of
that schedule's prompt comes up with it so you can see what you are deleting.

**Past runs of a deleted schedule cannot be reopened on the screen.** The way to that
conversation was that row. The transcript file itself stays.

There is no switch for turning one on and off. Deleting is the place where you pause. Since a
schedule is only a time and a sentence, making it again is not hard.

## When the list gets long

There is no cap. However many you have made, all of them show, and the half scrolls once they
run past it. There is no `Show more` row. The lower half of the `Schedules` surface holds this
one list and nothing else, so it never has to share the height with another list. The
`Conversations` group under `Sessions` still starts at three rows, and its `Show more` is
still there.

The order is the order you made them in, and there is no control for changing the sort.

## This belongs to this Mac

Schedules are not in the queue. They are in `~/.config/dira/home-sessions.json`. Not one new file
appears in the queue (`.dira`).

- **Open the same queue from two computers and the schedules do not follow.** Committing or
  syncing the queue does not change that. They were deliberately left out so two apps do not tread
  on the same row.
- You will never need to edit that file by hand. A line the app cannot read is treated as not
  being there, and it does not tell you where the mistake is either.
- **A run cannot change its own schedule.** The only place the session's writing reaches is
  inside the queue.

## What you cannot do

- You cannot make a schedule through conversation. Say `do this every day at nine` at home and
  the session points you at this screen. No file changes. The time is a value a person sets.
- Nothing outside can wake one. A webhook goes one way, outward ([Sending Awaiting answer
  somewhere else](/docs/webhook)). This app has no port that listens, so there is no way to start
  a run from Slack.
- It cannot wake a worker. What this schedule wakes is one session. It is not a place
  for scheduling ticket dispatch.
- There is no run now. To send the sentence without waiting for the time, just ask at home.
- There is no preview of the next runs. It does not say how many runs there have been, either.
  The time on the row is the next one and nothing more.
- You cannot see several projects' schedules on one screen. Each project has its own home.

Next is [Sending Awaiting answer somewhere else](/docs/webhook).
