# Submitting a request

You made a project in the last chapter. Now tell dira what you want out of it.

## Submitting a request, issuing a ticket

Two buttons sit at the top right of the board. `New request` on the right is the front
door. `New ticket` on the left is the side road.

![The New request dialog. One field for plain language and a submit button, and no field for kind, persona, or deps.](/shots/06-request.png)

`New ticket` makes you choose the title, the kind, the persona, and the deps yourself. It is a
form for someone who already knows what happens, who does it, and in what order.
`New request` is one field of plain language. Nothing needs splitting up first. Write what
you want in whatever sentences you want; the splitting is the next section's job.

- The first line becomes the title (cut at 80 characters). You do not write a title separately.
- The body is stored **exactly as you wrote it**. The app does not reword your sentences or
  fill in a skeleton.
- `⌘/` opens this field from anywhere inside the project. The button lives on the board only,
  but a request can occur to you while you are looking at a worker or reading a ticket.
- Once it is in, `Request received. The PM will review it shortly.` appears in the same spot.
  The screen does not drag you anywhere; press the `See the request you submitted` link
  below it to go to that request in detail. If you had an epic selected when you submitted, this
  sentence names that epic instead ([Epics](/docs/epics)).

## What happens after you submit

Submitting makes one `kind: request` ticket in the queue, assigned to the `pm` persona.

Within a minute a worker takes that ticket and starts a pm session. The pm session reads and
splits. One request turns into several work tickets, each with its persona set and as many
`deps` as the order needs. Each split ticket carries the hash of the original request in `req:`.
A hash is the eight-character name every ticket gets. That is why the request detail shows you
the tickets it became, and why a ticket detail takes you back to the request it came from.

When the splitting is over, the original request goes to `Done`. That does not mean the work is
finished. It means **the interpretation is finished.** The actual work is in the tickets below
it, and workers take those one by one, each starting a session as its own persona.

## Adding a decision to a request that is already being worked on

You can also put in a request from the home chat on the project home. Afterwards it is common to
add a decision in the same chat, something like "let's call the token this," and by then a worker
may already have claimed the request. So right before writing the decision, the home chat looks
up that hash in the queue again and acts on the state it finds.

| State of the request | What the home chat does |
|---|---|
| Open | Edits the request body. The next pm session reads the edited body |
| In progress | Adds a `## 추가 결정 - 홈 대화` section (additional decision - home chat) to the end of the request body, quoting what you said, and sends one interject line to the running session |
| Done | Leaves the original request alone. Makes a new request and writes the original hash in its `## 맥락` (context) section |

There is a reason it does two things when the request is in progress. The section in the body is
for a new session: if this one dies and the ticket is dispatched again, the next session reads it.
The running session does not reread a body it has already read, so the decision only reaches it
through the interject. The interject says, in Korean, that a decision was added to the
`## 추가 결정 - 홈 대화` section at the end of the ticket body, followed by a one-line summary.

A done request has already been split by pm. The new request is picked up and read by pm like any
other.

If the lookup finds no file for that hash, the home chat tells you it could not find the ticket in
the queue and stops. If it finds two or more, it shows you every filename and writes nothing
either. An orphan file already exists at that point, so clean it up first with the troubleshooting
section linked at the end of this section.

### Checking that it reached the session

Open that request's detail and find the step that is running in the [Progress record](/docs/screens).
If the sentence is there as an interject line, the session got it ([Talking to a running
session](/docs/barge-in)).

Sometimes the home chat tells you it could not send the interject. That happens when the ticket's
`inbox:` is empty, or when no session is reading that inlet. Put the decision in yourself, in the
input field at the bottom of the Progress record on the request detail. If there is no input
field, no session is running right now, and the next session will read the
`## 추가 결정 - 홈 대화` section in the body.

The home chat does not append to ticket files with shell commands. Appending to an old path
creates a new file with no frontmatter. If such a file already exists, the board warns you
([Troubleshooting](/docs/troubleshooting) §A ticket file warning appears on the board).

## Asking back, and `Awaiting answer`

When pm decides it cannot split something, it does not guess. It leaves a question and takes
its hands off.

That request then wears an `Awaiting answer` badge on the board, with the number of days it has
been sitting there. Open the request detail and the question is in the thread, with a field
underneath for your answer. Write the answer and the request goes back to `Open`, and this
time the pm session reads your answer along with everything else and carries on. It may ask more
than once. Questions and answers pile up in the thread, paired by number.

Until an answer is there, no worker touches that request. It is locked so that sessions do not
burn asking the same question over and over. So `Awaiting answer` is not a fault. It is a step
that was in the design from the start, and it stands there waiting for you.

## Your part in this

You put in a request, pm splits it, and workers take the split tickets one at a time. Where one
of them gets stuck, someone asks, and you answer. Writing tickets and deciding who to hand them
to is not your job.

There are times you will want to write one yourself: a single bug, a single typo, anything with
nothing to split. That is in [Writing a ticket yourself](/docs/ticket-writing).

Next is [The screens](/docs/screens).
