# Commands

A command is a named script. You chain shell commands such as `pnpm run dev` and prompts for the
agent as steps, and pick project environment variables to pass in if you need them. Press `Run`
and it runs in a terminal tab. Give it a schedule and the app runs it at that time, without a
terminal.

Each command is one file at `<project>/.dira/commands/<id>.sh`. Run it yourself with `bash` outside
the app and the same thing happens.

## Making one

Commands live on home. If you are on another screen, press the logo at the left end of the header.
Six icons sit in a row at the top of the left-hand panel, and the second from the left is
`Commands` (`⌘2`). The icons carry no names, so hover over one if you are not sure: the name comes
up as a tooltip. Press it and the lower half of the panel becomes the command list.

If you have not asked anything yet on this project's home, the first screen is onboarding and the
left-hand panel is not there. Ask anything once and the panel appears.

1. Press `New command` to the right of the heading on that lower half. The `Create` button at the
   bottom right has the same item. A dialog opens.
2. Write a `Name`. The list and the terminal tab title show it. It takes one line.
3. Put the work in `Steps`. Each step has a `Command` / `Prompt` toggle on top, and `Command` is
   selected to begin with. Press `Add step` for another one. Every step has `Move up`, `Move down`
   and `Remove step`.
4. If you need to, press the variable names under `Environment variables` that this command should
   get. The ones you pressed are selected.
5. To run it at a set time, turn on the `Schedule` switch. See [Scheduling](#scheduling) below.
6. Press `Create`. It only works once there is a name and no step is empty. With the schedule on,
   the time has to be valid as well.

The row shows up in the list at once. The top line is the name, and the bottom line is the next run
time or `No schedule`. Pick the row and the right-hand pane shows the steps, the environment
variable names you picked, the schedule and the last scheduled run, with `Run`, `Edit` and
`Delete command` at the top.

## Steps

Steps run in order from the top. **If a step fails, the later steps don't run.** It is the same as
`a && b && c` in a shell. Make the first step `false` and the second step never starts, and the
command as a whole ends with a non-zero exit code.

- A **`Command`** step is a shell command exactly as you wrote it. Several lines are fine. It runs
  from the project root.
- A **`Prompt`** step goes to the agent as a single `claude -p`. The answer is printed and the step
  ends. There is no follow-up conversation, so put everything you want done into that one prompt.
  There is no field for picking a persona.

A command that never ends on its own, such as `pnpm run dev`, holds up every step after it until it
exits. Put such commands last.

## Environment variables

The names under `Environment variables` are the ones registered for this project. If there are
none, you see `No environment variables yet. Add them under project environment variables in
settings.` Register them in settings first, then open the dialog again.

- **The file holds only the names.** At run time, only the variables you picked go into that
  process. The ones you did not pick stay out.
- The values never show on screen. If a command prints one, the terminal shows `***` instead.

## Running it

Press `Run` at the top of the right-hand pane. The left-hand panel switches to `Terminal`, and a new
terminal tab opens with the command's name as its title. The command file runs in that tab and you
see its output as it comes.

- A command that does not end, such as `pnpm run dev`, keeps running in that tab. **Close the tab
  and the process ends with it.**
- When the command finishes the tab stays, back at a shell prompt. Close it once you have read the
  output.
- Up to 8 terminals can be open at once. With 8 already open you get `Couldn't run the command` and
  `Up to 8 terminals can be open at once.` Close a terminal tab you are not using and press `Run`
  again.
- Reloading the browser does not keep the terminal tab's shell. That is covered in
  [Terminal, files, and source control](/docs/ide).

## Scheduling

The `Schedule` switch in the dialog starts off. Turn it on and the `Repeat` and `Time` fields
appear, with `cron` selected under `Repeat`. The cron field is empty, showing only the grey hint
`0 9 * * 1`. Unless you mean to write the five fields yourself, switch to `Once`, `Daily`, `Weekly`
or `Monthly`.

**It runs only while this app is open.** Set a time and close the app and nothing happens at that
time.

### Five kinds

| `Repeat` | `Time` field | When it runs |
|---|---|---|
| `Once` | Date and time in one field | Once at that time, then done |
| `Daily` | One time | Every day at that time |
| `Weekly` | One weekday and a time | That weekday at that time |
| `Monthly` | A day from 1 to 28 and a time | That day at that time |
| `cron` | You write the five fields | Every minute that matches the string |

- **`Monthly` goes up to the 28th.** Some months have no 29th to 31st. The screen says so in a line
  under the field. There is no `last day` value.
- Times are read in this computer's time zone. There is no field for picking a time zone.
- With any of the first four, you don't see a cron string. The screen writes it for you.
- There is no `every 30 minutes` option. Write such a period in the `cron` field, as `*/30 * * * *`.

### The `cron` field

Write five fields separated by spaces: minute, hour, day, month, weekday.

| Field | Values |
|---|---|
| Minute | `0` to `59` |
| Hour | `0` to `23` |
| Day | `1` to `31` |
| Month | `1` to `12` |
| Weekday | `0` to `6`. `0` is Sunday |

A field takes `*` (all), a single integer, a range `1-5`, or a step such as `*/10` or `9-18/2`, and
you can join these with `,` as in `1,3,5`.

- `*/10 9-18 * * 1-5` - every 10 minutes from 9 to 18 on weekdays
- `0 9 * * 1,3,5` - 9 o'clock on Monday, Wednesday and Friday
- `30 2 1 * *` - 2:30 on the 1st of every month

**Four things are not accepted:** names such as `MON` or `JAN`, macros such as `@daily`, a sixth field
for seconds, and weekday `7`. The app checks every 15 seconds, so nothing shorter than a minute can
be set.

**If you put numbers in both day and weekday, it runs only on days that match both.** `0 9 13 * 5`
is 9 o'clock on a Friday the 13th. crontab runs when either one matches; this does not.

Type a value and a line appears under the field. If the syntax is right it tells you when the next
run is; if not, it tells you what is wrong. While it is wrong, `Create` stays disabled. If the
syntax is right but no run falls within the next 31 days (`0 9 30 2 *`), it says so. You can still
create it, but the list shows `No next run`.

### When it runs

- The app checks every 15 seconds and runs commands whose time has passed. The same thing runs as
  when you press `Run`, only without a terminal. This is a different setup from the automatic runs
  that call workers ([Running the engine alone](/docs/cron)), so no cron line is added.
- **A run missed while the app was closed happens once, late, when you open the app.** Close it for
  three days with a 9 o'clock daily command and you still get one run. Time the Mac spends asleep
  counts as the app being closed.
- Runs more than 31 days old never happen. A `Once` whose time is that far past stays in the list
  with `past` at the end of its bottom line.
- **If the previous run is still going, this one is skipped.** Schedule a command that never ends
  and it will not run again after the first time.

### Seeing the last scheduled run

Pick the command in the list and `Last scheduled run` sits near the bottom of the right-hand pane.
One line shows when it ran and its `Exit code`, and under it are the last 200 lines of output. While
it is still running the exit code reads `Running`, and if it has never run you see
`No scheduled run yet`. The screen reads this part again every 5 seconds.

- The output is in `.dira/commands/<id>.log` and each run overwrites it. Earlier runs' output is not
  kept.
- This part shows scheduled runs only. What you ran with `Run` is only in that terminal tab.
- No notification says a run has finished. A failed run is not retried; the next run happens at the
  next scheduled time.

## Editing and deleting

Press `Edit` and the same dialog opens, filled with the current values. Change them and press
`Save`.

Press `Delete command` and you get `This deletes the command` with its name. Press `Delete` and the
script file and its last log are removed together. There is no on/off switch, so to pause just the
schedule, turn `Schedule` off in `Edit` and save.

## The file

One command is one `.dira/commands/<id>.sh`. The `id` is 8 hex digits and the file is executable.
Make a command in `New command` with two steps, `echo one` and `echo two`, and you get roughly this:

```bash
#!/usr/bin/env bash
# dira-command: 1
# name: dev
set -euo pipefail
cd "$(dirname "$0")/../.."
# step: shell
echo one
# step: shell
echo two
```

- If you picked environment variables, a `# env: A,B` line follows the name; if you set a schedule,
  so does a `# schedule: <time>` line. A prompt step becomes a block starting with
  `claude -p "$(cat <<'DIRA_PROMPT'`.
- The list reads this directory again every time you open the `Commands` surface. If you changed a
  file in an editor, go to another surface and come back.
  Lines you added by hand stay when the app saves the file again.
- A file without the `# dira-command: 1` line still shows in the list as long as it is named
  `<8 hex digits>.sh`. It carries a `Not editable` badge and only `Run` and `Delete command` work.
- It is under `.dira/`, so it does not go into git.
- The time and exit code of the last scheduled run are not in the file but in this Mac's
  `~/.config/dira/home-sessions.json`. Open the same queue on another computer and you see the
  command files, but not that record.

## Old schedules became commands

Schedules made before this feature are moved to commands once, the first time the app starts. Each
schedule becomes a command with a single `Prompt` step and the same time. Its name is the first line
of the original prompt. Starting the app again does not move them twice.

- The persona you had picked for a schedule is not carried over. Prompt steps have no persona field.
- From then on a run is kept in `Last scheduled run`, not in a conversation thread. The rows that
  opened the old runs' conversations are gone from the list.

## What it cannot do

- You can't make a command by chatting. Saying `do this every day at 9` at home creates no file.
- Nothing from outside can start one. The app has no listening port, so there is no way to run a
  command from Slack. Webhooks only go out ([Sending Awaiting answer somewhere else](/docs/webhook)).
- It does not wake workers. It is not a way to schedule ticket dispatch.
- It only writes `.sh` scripts. There is no Windows script.
- You can't see several projects' commands on one screen. Each project has its own home.

Next is [Sending Awaiting answer somewhere else](/docs/webhook).
