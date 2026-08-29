# Writing a ticket yourself

[Submitting a request](/docs/requirements) is the road where you put in what you want to say, as
you would say it, and wait for pm to split it. This chapter is the other side. Use it when you
already know what you want done. A single bug, a single typo, work that is already broken into
small pieces — there is nothing there to interpret. And no reason to burn a pm session
interpreting what needs no interpreting. When that is the case, write the ticket yourself.

Underneath, one file gets made either way. The only difference is that the hand writing it is a
form instead of a pm session.

## The new-ticket dialog

Two buttons sit at the top right of the board, and the left one is `New ticket` (the primary on
the right is `New request`). `⌘I` on the board opens it too. That key is the default and you
change it in the keymap under settings. It is a dialog rather than a page, so cancel is the same
as close, and the board is still behind it with its filters, its search, and its scroll intact.

There are seven fields.

| Field | What goes in |
|---|---|
| `title` | Required. A one-line title |
| `kind` | select — `work` · `request` · `feedback` |
| `persona` | select, in two groups. The personas that actually have a profile, and the [squads](/docs/squads) in this project. A new project opens with `Squad default` already chosen |
| `Priority` | select, 1 to 5. Default 3 |
| `Due date` | A date and a time. Leave it empty for no due date |
| `deps` | A multi-select over existing tickets. No free text |
| Body | Comes pre-filled with a `## Goal` · `## Done when` skeleton |

- The server makes the hash. It draws eight characters from 0-9 and a-f (hex) and draws again if
  the value is taken. File creation is `O_EXCL`, so the same name cannot come out twice either.
  There is nowhere on this screen for a person to type a hash.
- The point of the `deps` field is that it has no free text. Back when hashes were typed by hand,
  one wrong character made a prerequisite that did not exist. A ticket that is not there is never
  finished, so the ticket waiting on it waits forever. If all you can do is pick, that accident
  cannot happen structurally.
- A successful new ticket takes you to that ticket's detail. That move is what closes the dialog.
  You see your own ticket land in the queue, right there.
- Below the body is the attach handle. Paste an image or pick a file and what gets appended to
  the end of the body is the path, not the bytes (the same way attachments work in [Talking to a
  running session](/docs/barge-in)).
- If you have text half-written, closing is blocked once. It asks with `You have unsaved text`,
  and only `Discard and close` throws it away. When a new ticket fails, the dialog stays open with
  the reason inside it. Closing never costs you what you wrote.

## How to write `## Done when`

This is the most important spot in the chapter. If `## Goal` is two to four lines on why this is
needed and what gets built, `## Done when` is the sentence that decides whether it is finished.

A sentence you can decide on has the shape "run command X and Y comes out."

Bad:

```markdown
## Done when
- [ ] CSV export works fine
- [ ] Improve the filters too
```

Good:

```markdown
## Done when
- [ ] `/orders` shows a `CSV export` button
- [ ] Pressing it drops a file holding only the rows the current filters leave
- [ ] The column names in the header row are in Korean
```

"Works fine" is a sentence a session cannot decide with its own hands. So the session either
cannot tick that item or ticks it with nothing behind it. Either way, the screen ends up lying.
Every time a session satisfies one item, it changes `- [ ]` to `- [x]` on the spot, and those
checkboxes are exactly where you look when you open a running ticket to see how far it has got
(the progress display in [The screens](/docs/screens)). Only a sentence you can verify makes that
display true.

"Improve the filters too" is a different problem. One ticket is carrying two things. Read more
than six items as a signal to split. One ticket should be one change a session (5 to 25 minutes)
can review. If it needs three screens and their tests, that is not one ticket but four.

## `kind` — the four classes of ticket

There are four values and only three are in the select. The app writes the fourth.

**`work`** — an instruction. The persona that gets it does the work and moves it to done when it
is over. Most tickets you write yourself are this.

**`request`** — a favour or a question. Whoever gets it does not append the answer to the
original; they make a new ticket. The original stays as it is, as the record of the question. A
`New request` makes a ticket with this value and `persona: pm` on it.

**`feedback`** — a report or a criticism. Whoever gets it makes a new ticket if something needs
doing, and otherwise just closes it.

**`answer`** — an answer file. It is not in the select. When a person writes an answer on a
ticket that is `Awaiting answer`, the app makes one file with this value, and it is born done.
Nobody performs it (see the next chapter, [The states a ticket passes
through](/docs/states)).

The engine does not enforce `kind`. The form does. A value from outside the select comes back
refused with a reason. The board's kind filter runs on this value too. This one line is the only
clue the next person or session reading the ticket has for telling an instruction from a question
from a report. Do not leave it empty.

## `persona` — the role that takes this on

The body of `personas/<name>/PROFILE.md` for the name you pick is inlined verbatim at the head of
the session prompt. Give the same job to `developer` and it writes code; give it to `qa` and it
goes off to break that code. This one field makes that difference (see [Personas](/docs/personas)).

- A persona attaches to a ticket, not to a worker. Any worker takes it, and the worker that took
  it opens a session as that ticket's `persona:`.
- Only names that actually have a profile show up in the select. A name with no `PROFILE.md`
  leaves the engine a warning and it runs anyway, but such a name does not become an option on a
  new ticket.
- You can leave it empty. A worker picking up one open ticket and opening a session is called
  dispatch, and dispatch works the same with the persona empty; that is the normal path. Attach
  one only where the role changes the judgement.
- **In a new project this field opens on `Squad default`.** That is the squad laid down along
  with the project, and its leader is pm ([Squads](/docs/squads)). Publish it as it stands and pm
  reads it and works out whose it is. If you already have someone in mind, pick a persona in the
  same field. For nobody at all, take `None` at the top of the list. In a project where that
  squad has been deleted, it opens on `None` from the start.

## `deps` — only for what makes starting impossible

The tickets you pick in the multi-select all have to be **done** before this ticket appears in
the queue. If even one is unfinished, it sits in the board's `Open` lane wearing an orange `deps`
tag, and no worker picks it up in the meantime.

Do not put one on work that can run in parallel. Overuse leaves workers idle and serialises the
queue. Six workers still run six chained tickets one at a time. The test is a single question: is
starting this impossible until that finishes? "Handy to have around first" is not a `deps`.

## `Priority` and `Due date` — where you come up in the queue

`deps` decides whether a ticket can be started; these two decide the order after that. The
default is 3, and a higher number comes up first. Ties go in creation order.

Only the two ends behave differently.

- **1 is a candidate only while zero tickets are in progress.** If anything else is running, its
  turn comes and it gets skipped.
- **5 cuts off a running session.** With no worker left free, it sends `TERM` to the session with
  the lowest effective priority and takes that slot. The cut-off ticket goes back to open, and
  what happened to it is written into its own `## 선점` (the preemption section). Sessions do not
  use this value. Only people do.

A prerequisite inherits the value of the ticket waiting on it. If a priority 5 ticket is stuck
behind a priority 3 prerequisite, that prerequisite comes up as a 5 and clears first. Otherwise
the 5 would come up behind the 3. The inherited value is recounted every time, so it does not
touch `priority:` in the file.

`Due date` covers that order with a clock. Five hours or less left counts **as a 5**; seven days
or more counts **as a 1**. A due date already past is a 5 too. In between, the priority you wrote
comes up as written. So writing a due date two weeks out actually pushes a ticket back for the
first few days. To pull something urgent forward, raise the priority. The due date field is for
writing down when it is wanted by.

If a prerequisite is due later than this ticket, the publish button locks and the hashes that are
out of order appear under the input. A prerequisite cannot finish after the ticket waiting on it.

## Duplicate — starting from a ticket you already have

`Duplicate` at the head of a ticket's detail is **a button that opens this same new-ticket dialog
filled in with the original's values**. It is the same form, not a new screen, so fix the title
and the body where it opens and publish. It does not care about state. It only reads the original,
so it is safe even on a ticket in progress.

Four things come across: `title` · `kind` · `persona` · the whole body. The body brings any
`## 결과` (the outcome section) and `## 블록` (the block section) a worker added along with it.
Cutting by section name eats healthy sections too, and the place to delete is the textarea in
front of you.

**The assignee field goes to the original.** If the original had neither `persona:` nor `squad:`,
the duplicate opens on `None` too. The `Squad default` a fresh new ticket gets does not cover the
original's empty value.

**`deps` opens empty.** Duplicating unmet prerequisites would leave the copy quietly waiting.
What comes before what depends on the state of the queue at the time, so pick again in the
multi-select. Priority and due date are not inherited for the same reason. They open on the
default 3 and an empty field. The keys the engine uses
(`session_id` · `owner` · `pid` · `awaiting`…) do not come across either. Put those values on a
new ticket and it looks already assigned, and never gets dispatched.

## Tickets you can edit, tickets you cannot

`title` · `kind` · `persona` · priority · due date · body on a published ticket stay editable
from the detail screen. **`deps` is not on that form.** A field you type into makes permanent
waits out of mistyped hashes, and the one place that builds a list to pick from is still the
new-ticket dialog. To change what comes before what, duplicate and pick again, or edit the
`deps:` line in the ticket file directly. Depending on the state, two more things lock.

- A done ticket is read-only. Editing, deleting, and unassigning are all blocked. The existence
  of a `.done` file is itself this queue's history. If you want the same job again with the
  conditions changed, that is what `Duplicate` above is for.
- A ticket in progress is editable only after you unassign it. A session is holding that file and
  writing to it right now, so editing underneath tramples a running session's work. Press
  `Unassign` on the lock card and the ticket goes back to the queue; the edit form opens after
  that.

## The rest of the frontmatter keys

The seven fields the dialog asks about are **all the values a person writes.** The rest of the
keys are written by the dispatcher and the engine. That header, written as `key: value` between
the two `---` lines at the top of a ticket file, is called frontmatter. What each key means and
who writes it when is laid out as a table in [frontmatter fields](/docs/ref-frontmatter). It does
not get set up again here.

Next is [The states a ticket passes through](/docs/states).
