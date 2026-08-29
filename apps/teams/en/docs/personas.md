# Personas

A session receives more than the ticket. The first thing in its prompt is **who is doing this
work**, and a persona is what fills that slot. It is a markdown document with one role written
in it, and the app has a screen of its own for it, so all you ever edit is the body.

The first block of the prompt is the core protocol, which the whole queue receives alike, and
the persona comes right after it. What goes where is covered again in How the prompt is
assembled, below.

## `persona:` - the role a ticket decides

A ticket's `persona:` value is the profile name. The body of the profile by that name rides in
the session prompt as it is. Neither the worker nor the project decides it; each ticket decides
for itself. The same project and the same worker will run as a different persona from one
ticket to the next.

Create a project and five come with it: pm, developer, qa, designer, archive-manager
([Create your first project](/docs/first-ticket)). You call the first four by writing the name
on a ticket. archive-manager gets called by the session that finished a ticket, which issues an
archive ticket on its own, and it moves only the facts worth keeping from finished work into
the ontology ([Archiving and the ontology](/docs/ontology)). They are a starting point, not a
fixed list. From the moment they are copied they belong to this project, so edit them, delete
them, and make new ones on the screen.

Instead of one persona you can hang **several of them, grouped**, on a ticket. Then the leader
of that group takes the ticket and decides whose it is ([Squads](/docs/squads)). You build the
group on this same screen.

There is one test for attaching a name. Does the role change the judgment? The same "the button
does not work" leaves reproduction steps and evidence when qa takes it, and gets traced to a
cause and fixed when developer takes it. Write the name only on tickets that split like that.

**You can leave it empty.** That is the normal path. A session running with no persona gets the
protocols and the ticket instruction, nothing else. No warning is left either.

If the name is written but there is no profile for it, all you get is a warning.
`Some personas have no profile file` appears at the top of the Squads screen, and that row in
the list wears a `No profile` badge. The engine does not block it. It leaves one `WARN` line in
the log and dispatches without a persona. The ticket does not stall, but that session starts
knowing neither its role nor its authority.

## The Squads screen - pick on the left, edit on the right

That is `Squads` in the header. Editing a persona happens here. The address is still
`/p/<project>/personas`, so a link you saved still opens. The screen is two columns. The list
is on the left, the one you picked is on the right. On a narrow window the list goes on top and
the editor drops below it.

**`Group view` sits at the top of the list.** One checkbox swaps the axis of the left list.
Turn it on and squads are top level with personas inside them. Turn it off and two groups,
`Squads` and `Personas`, stand side by side. Leave it on while you are building squads. Turn it
off when you are working through personas one at a time.

**It is on by default.** Turning it off is not saved anywhere. Refresh and it is on again. Same
rule as the folding below. What this screen's address carries is the one name you picked. So
whatever state you saved the link in, it opens with the toggle on for whoever receives it.

**With it on, the top-level rows are squads.** Personas are folded inside the squad they belong
to. Press the `>` at the far left of a row and it opens, and the members become child rows in
`members` order ([Squads](/docs/squads)). A folded row stacks its members' color dots in that
same order and carries the name and `Members n`. From six members on it draws only the first
five. The count is already in `Members n`. Hover the dots and every name appears. A squad has
no color of its own. If even one member has no profile, `Member has no profile` is added.

Open it the first time and the list is all folded. The first squad is picked and the right
column is that squad too. Once you pick a persona, only the squad holding that persona is open.
Going straight to an address like `/personas/writer` is the same. Unfold by hand, refresh, and
it folds again. Folding is not saved anywhere.

If one persona belongs to two squads it appears in both. Pick that name and both rows are
marked and both squads open. That happens because either row leads to one address.

**A persona in no squad appears at the bottom under `No squad`.** This group does not fold.
Fold it and a persona that belongs nowhere would leave the screen. In a new project the one
sitting there is archive-manager. `default` holds the rest. Delete every squad, the other way
around, and the group headings go with them and personas come up flat, one row each.
`No squad` goes too. With nothing to divide there is nothing to name. `Group view` is not there
then either. With no axis to switch, it is the same screen.

**With it off, two groups stand side by side.** `Squads` on top, `Personas` below. A squad row
still carries the stacked dots, the name, and `Members n`. All that goes is the `>` and the
child rows under it. To see who the members are, pick the row and open the right column.

The `Personas` group holds everyone once. A name that is in a squad is here too, and a name
across two squads is still one row. The axis is the name. `No squad` does not appear. In a list
where everyone is already showing, there is no place to gather some of them again.

**Nothing is lost between on and off.** The picked row holds, and the right column does not
close. Squads you had unfolded stay unfolded. Pick a persona with it off, turn it back on, and
the squad holding that name comes back unfolded.

**The hand that adds and removes members is not on the left.** On or off, the same. You cannot
drag a row somewhere else and there is no add or remove button. Assignment happens by picking
the squad row and using the `Members` section in the right column ([Squads](/docs/squads)).

One persona row tells you everything about that persona. Color dot and name on the top line;
the tickets that reference it, `Skills n`, `Memory n`, `Limit n`, and the budget on the line
below. A kind with no value does not appear at all.

The persona you picked stays in the address: `/p/<project>/personas/<name>`. Save that as a
link and next time it opens with that row picked, and pressing back returns the list selection
and the right column together.

The head of the right column is two lines. It tells you what state this persona is in before
you open a tab, and it does not change when you switch tabs.

Four things on the top line. Color dot, name, the first line of the profile, `Delete`. The
first line of the profile is taken from the top of the document letter for letter. The profiles
that ship by default have a title on the first line, so `# PM` comes through as it is. Rewrite
that line as one sentence of role and that sentence shows here. Longer than the column and the
tail is cut, so hover to read the whole thing. A persona with no profile file yet gets a
`No profile` badge in that spot instead.

The line below is three small things. `Running 3 / Limit 5`, `12m ago 9f2c1a04 closed`,
`Squad default`. A spot with no value is simply empty. A persona that has never run has no
middle at all, and a persona in no squad has no right-hand piece. With no cap set, only
`Running 3` is left.

**The hash in the middle is a link.** Press it and that ticket's detail opens. Read there what
this persona just closed.

**`Running 3` is a count, not a state.** It means three tickets under this name are in progress.
Zero is not a warning either. It only means there was nothing to call it for, so it gets no
color.

**`Limit 5` is a read-only display.** You cannot edit it here. You edit it in the
`Dispatch policy` section at the top of the `Profile` tab (Dispatch policy, below).

Below the head are two tabs (next section). The two dispatch policy values, the profile editor
and `Save`, the `Skills` section, and the `Memory` section appear in that order inside the
`Profile` tab. The editor has the same two modes as the [Protocols](/docs/protocols) screen.
WYSIWYG is the default. Press the handle and the markdown of `PROFILE.md` comes up as it is.
Edit in either one and the only thing that changes in the file is what you changed. Lines you
did not touch stay.

- **What the budget on the list row measures.** The profile body plus the list of skills you
  turned on. The 5,000 B budget appears behind it. Those two are the only share that rides in
  every dispatch prompt in full. Go over and one word is added, like `5,387 / 5,000 B over`.
  The unit is bytes, the same as the badge on the Protocols screen, so you can read it side by
  side with `wc -c` in a terminal.
- **Memory is not in that sum.** It does not ride in the prompt. Its own count appears at the
  head of the `Memory` section in the `Profile` tab instead, and what is attached there is the
  150,000 B retrospective budget (`AGENTS.md`, the total of a persona's `memory/`). This is the
  only place that grows without anyone touching it. If the count on a persona you have not
  touched is bigger next week, sessions left retrospectives in the meantime. Open that section.
- Pick another row and what you were editing before stays. `Save` shows only on the persona you
  picked, so a persona left unsaved gets `Unsaved` on its list row.
- A persona with no profile opens an empty editor. Saving is creating. Fill in the name a
  ticket is calling for, right there.

Press the color dot and a palette opens. The one place to pick is the head of the right column;
the dots on list rows are read-only. The color you pick follows the persona to board cards and
the table, the persona filter, and the ticket form. The color is stored on this computer only
and does not go into the project. Open it on another machine and the dot is neutral. Color
never carries meaning by itself, so the name text comes with the dot everywhere.

## The Activity tab - what it is doing and what it has been doing

The tabs are `Activity` and `Profile`. `Activity` is open when you first arrive. This is where
you read what this persona is holding right now and what it has been closing lately. There is
nothing to edit here. Everything your hands reach is gathered in the `Profile` tab next to it,
in the order it has always been.

Someone who came to edit a profile came with a purpose and presses one tab. Activity is a value
you look at because you do not know it, and no other screen can tell you. That is why
`Activity` opens first.

The tab is not carried in the address. Pick another row in the list and it opens on `Activity`
again. Come look at `Activity` in the middle of editing a profile and the edit does not die.
Meanwhile the `Profile` tab label carries `Unsaved`, so you can also see where your hands are
still resting.

There are four sections.

- `Now` is the in-progress tickets this persona is holding. Each row shows the hash and the
  title, the ticket kind (still Korean: `작업` work, `요구사항` request, `피드백` feedback,
  `답변` answer), which worker took it, how long since it was claimed, and the `5/8` progress
  of `## 진행 계획` (the plan section). A ticket with no plan leaves that spot empty. A ticket
  where the session left a `## 블록` (the block section) and stopped gets `Blocked`. Holding
  nothing gives you one line, `No tickets running now`.
- `Waiting on` is the tickets locked while waiting for an answer from you. How many days it has
  been comes with it. How they come to be locked is in the asking-back section of
  [Submitting a request](/docs/requirements). **This section does not appear on the screen at
  all when it is empty.** Not seeing it is normal. Do not go looking for it. It means this
  persona has nothing out with you right now.
- `Recent` is the last twenty tickets this persona closed. Each row shows the hash and the
  title, the kind, how long ago it closed, how long it took, and which worker it was. Past
  twenty, press `View on board` at the right of the section head. The board opens filtered to
  this persona.
- `Last 30 days` is four numbers and one bar chart. `Closed:`, `Median duration:`,
  `Reassigned:`, `Issued:`. The bars are how many closed each day, and hovering one gives the
  date and the count. `Issued:` counts the tickets that came out of the tickets this persona
  closed. What pm and designer mostly leave behind is the next ticket, so this number runs high
  for them. developer sitting near zero is normal too.

**`Reassigned:` is not a count of failures.** What it counts is how many times that ticket was
dispatched again. When a session is cut off before it finishes the work, the ticket goes back to
Open and the next tick picks it up and hands it to a new session. One round trip like that
is `Reassigned: 1`.

Cut-offs mostly happen three ways. The session hits an account limit and stops where it stands,
the session dies on an error, or it hangs long enough to be reclaimed. None of the three has
anything to do with the persona's judgment. Where it was cut off, and why, is in the
[Workers](/docs/worker) screen and [Reading the logs](/docs/logs).

**Every ticket in this number was closed in the end.** The same ticket is in the `Recent` list
just above and in the `Closed:` count as well. What reassigned tells you is how many more
sessions it took to finish that one ticket. It is a cost, not a grade.

**There is no success rate. We left it out on purpose.** Count cut-off sessions as failures and
take a ratio, and the pm in this queue comes out at 33%. Meanwhile that pm has closed more than
590 tickets. So that ratio is a lie. Rather than leave the spot empty we give you the number of
tickets closed. That is what actually remains.

**`Median duration:` is not an average.** It lines this persona's sessions up by how long they
took and picks the middle one, and it appears in minutes, like `Median duration: 9.2m`. In dira
one run is one session. Mix in one round that hit a limit and hung for hours and the average
follows it there. Then it stops showing you how long most sessions actually take. The median
does not move for that one.

Duration and reassigned are only as true as the logs reach. The window is 30 days, but if this
queue's `runner.log` is shorter than that, the shorter one is the real range. What could not be
measured is left blank, not filled in with zero.

## Dispatch policy - the cap and the engine

The `Dispatch policy` section at the top of the `Profile` tab holds two values. Unlike the
profile, the skills, and the memory, these two put not one letter in the prompt. They are the
values the engine reads when it picks a ticket.

**The cap** is how many in-progress tickets this persona can hold at once. The default is
`None`. Then workers sweep from the head of the queue and take whatever they catch, and that
opens a window where one persona holds several workers at once: archiving takes six and the
rest of the work sits waiting. Put in `2` and once two are in progress that persona's tickets
are not taken, and the worker moves on to the next candidate. `0` stops dispatch. Use it on a
persona you want parked for a while.

**The engine** is what this persona's sessions run on. The default is `Not set`, and then the
engine of the worker that picked the ticket runs it ([Workers](/docs/worker)). A gray line
under the value tells you what the workers are using now. Pick here and whichever worker picks
it up, this persona runs on that engine and that model. Press `Clear` and it goes back to the
worker's side.

Both write the file the moment you save, but what they catch is **the next ticket selection
onward**.

## What goes in a profile - role, authority, judgment

What to write is already written in the line right in front of the profile. As it hands the
profile over, the engine tells the session that what follows is its role, its authority, and its
judgment, and that it should act as this persona consistently while it works the ticket. The
session reads looking for those three. So those three are what you write.

- **The role is one line.** All five defaults have the role in the first sentence. qa is to
  break the claim that something is done, developer is to turn one ticket into running code and
  leave evidence that it runs, archive-manager does ontology work and nothing else. This line
  decides everything under it. Blur it here and no amount of length below will give it a
  direction.
- **Authority draws how far it may reach.** The qa profile writes down that when it finds a bug
  it does not fix it itself, it makes a ticket and hands it over. How to hand it over has to be
  written next to it, or the session stops at the boundary.
- **Judgment settles in advance which way to go at a fork.** developer's `The first approach
  that works is the right answer`, designer's `A color that is not defined for both light and
  dark is not defined`. They are rulings rather than tastes, so the next session picks the same
  side at the same fork.
- **Write what it does not do, too.** That is the last section of the qa profile. It is fixed
  there that ugly is the designer's business and that qa looks only at what differs from the
  spec. On a project with several personas, this line is what keeps their areas apart.

All five are first person. Four open with `My job is` and archive-manager alone starts with
`I do ontology work, nothing else`. What reads them is a session rather than a person, so that
sentence becomes the session's own words right where it stands.

When you are stuck, open the five defaults. The shortest, designer, is 23 lines; the longest,
archive-manager, is 85; the other three are in between. Pick a row and the original is right
there, so the fastest start for a new persona is to copy the nearest one.

## What does not go in a profile - the protocol's share and the ticket's

The profile rides in every dispatch of that persona, and the byte count on the list row is what
it costs each session (the Squads screen, above). However much you want to put everything in,
send a sentence that has another home to that home.

- **A rule that is true for everyone is a protocol.** Commit and reporting format, how to hand
  work off, what to leave behind when stuck. It is a place where the ticket does not choose and
  everyone gets the same thing, so writing it in a profile too puts the same words in one
  prompt twice. The next chapter, [Protocols](/docs/protocols), covers that file.
- **An instruction true only this once is a ticket.** "Fix this section of this file like so"
  belongs in `## Goal` and `## Done when`
  ([Writing a ticket yourself](/docs/ticket-writing)). Put it in a profile and every session
  keeps getting a past ticket's instruction long after that work is over.
- **What you found out by doing it in this project is memory.** Memory, below, covers it. All
  that needs saying here is that it is not a box a person sits down and fills.

**When a profile and a ticket instruction disagree, the ticket wins.** The engine writes exactly
that in front of the profile it sends: follow the ticket, and leave the fact of the conflict in
the ticket body. That is why you do not have to write every exception into the profile in
advance.

## Skills - the tools this persona reaches for first

The `Skills` section of the `Profile` tab. Press `Add skills` and you can search the skills
installed on this computer and pick several. What you pick is saved to
`personas/<name>/skills.md` and rides in that persona's prompt right after the profile block.

**The session already has the list of installed skills.** What you put in here is not a tool
but a pointer. It means "for this work, you use this one first."

**To set one down for a while, use `Turn off`.** Press `Turn off` at the right of the row and
the row drops out of the list and goes below, under `Off`. To bring it back, press `Turn on` on
that row. There is no confirmation and it does not wait for `Save`. The moment you press, that
name is written across to `personas/<name>/skills-off.md`. The candidate list in the
`Add skills` dialog still holds the ones you set down. Check it there again and it comes back on.

Watch where this parts from `Remove`. Neither one touches a byte of the installed copy on this
computer. Remove it and the skill is still there and still in the candidate list. One thing
parts them. `Remove` erases the record that you attached this to this persona as well. To undo
it, a person has to remember what was attached. `Turn off` keeps that record and takes it out
of the prompt only. It is the hand for when ten skills are attached and you want to set down
just the expensive one for a moment.

**A skill set down puts not one letter in the prompt.** Not the name, not the description, not
even the file path. The session does not know a turned-off skill exists. The budget counts only
what is on. So turn every skill off and `Skills n` disappears from the left list row while the
section, unfolded, still holds the list under `Off`. That is not a fault. What that meta
measures is how much of the prompt this persona eats, and a skill set down is worth 0. With
none of them on, the line under the section head changes to one that starts with
`No skills turned on`.

- The skill share is in the budget because the list rides along with the profile. Its own share
  appears at the section head, without a budget. The only place a budget attaches is the one
  number, profile and skills together.
- **Several personas may pick the same skill.** No rule stops it. The files are per persona and
  do not look at each other. pm and qa may both attach the same skill and it appears as one row
  in each of the two files. Turn it off or delete it on one side and the other does not change.
  In exchange, there is no place that counts "every persona using this skill." For that there
  is nothing but unfolding personas one at a time.
- At zero the file is deleted. No empty file is left behind. The set-down list follows the same
  rule. Turn them all back on and `skills-off.md` is gone.
- **They ride on the claude engine only.** Other engines have no notion of a skill, so sending
  it as it is sends a sentence telling them to use a tool that is not there. The section says so
  in one line inside it.
- No profile, no skills either. The skills block only attaches inside the persona prompt, so
  there is nowhere to lay a selection on a session that does not know its role.
- The candidate list in the dialog is this computer's. A skill picked on another machine stays
  as `Not on this machine` and is not deleted. What you picked is in the project, so it follows
  the project when you move it.
- Not in the list? You can install it right there. Drop a folder holding a `SKILL.md` onto the
  dialog, or pick one `.md` or `.skill` file with `Browse`.

**A skill you saw on GitHub installs from its address alone.** Right below the `Browse` line
there is an address field and an `Install` button. Copy the browser address bar, paste it, and
press `Install`. `Enter` does the same. Download, unzip, find the folder, drag it over: that
whole procedure shrinks to one line.

These six addresses can be pasted.

| What you paste | What gets installed |
|---|---|
| `https://github.com/owner/repo` | That whole repo |
| `.../tree/<branch>` | That branch's whole repo |
| `.../tree/<branch>/<path>` | That folder only |
| `.../blob/<branch>/<path>/SKILL.md` | The whole folder holding that file |
| A file address on `https://raw.githubusercontent.com/` | Same as above |
| A `.skill` address on skills.sh | Same as dragging that file in |

**Pointing at a file does not bring that one sheet alone.** A skill runs only with `SKILL.md`
and the `references/` next to it, so pasting a file address fetches the whole folder holding
that file.

While it fetches, the guidance sentence on the `Browse` line changes and tells you up to 30
seconds. It fetches a whole repo, so it takes longer than a file does. On success the skill
appears in the candidate list with its checkbox already on. The search box fills with the name
you just installed so the list narrows to that one row, and the address field empties. On
failure the address stays. The text you need to fix has to be there.

**It fetches from four hosts** - `github.com`, `codeload.github.com`,
`raw.githubusercontent.com`, `skills.sh`. Not `https`, or outside those four, and it does not
even make the request. A skill on an in-house GitLab or a personal server cannot come in
through this field. Download it and drop the folder onto the window. An attachment address on a
release page is outside the table above too, so it is refused. `.tar.gz` or `.zip`, the same.

When it is refused the dialog stays open and one line of reason is added. Four reasons come
from the address route alone.

- `Can't fetch from this address`. The shape is outside the table above, or the host is outside
  the four. What to fix is the address you pasted.
- `Couldn't fetch from that address`. Check that the address is right and that the repo is
  public. **No login and no token is attached for a private repo.** Rather than open one more
  screen that handles credentials we left that route empty, and so a private repo's 404 arrives
  as this sentence. Fetch it with `git clone` and drop that folder onto the window.
- `Stopped — the download went past the size limit`. It stops at 20MB. Even for a folder
  address the order is to fetch the whole repo and then keep only that folder, so a small skill
  in a big repo catches here. Download it and drop just that folder here too.
- `That repo has no folder at this address`. The shape was right and the branch or the path was
  wrong. Check `main` against `master`, and whether the last component of the path is right.

Every other refusal is the same sentence as installing from a file. One route, one ruling.
Install the same skill twice and the name collides and it is refused, and not one byte of the
one installed first changes.

It installs into `~/.claude/skills/<name>/` (under `CLAUDE_CONFIG_DIR` if you use one). There
is no telling it apart from a skill you installed by hand. Where it came from is written down
nowhere.

**This product has no screen for deleting or updating an installed skill.** Neither the
`Remove` nor the `Turn off` above touches the disk. Deleting happens in Finder, and with `rm`.

```
open ~/.claude/skills             # open that folder in Finder
rm -rf ~/.claude/skills/<name>    # delete it
```

Updating is the same hand. Delete it and paste the address again. Reverse the order and the
name collides and it is refused.

Install from an address, then press `Cancel`, and the skill stays on the machine. What is
installed is a fact of this computer and what is attached is a fact of the persona, so what
`Cancel` undoes is the second one.

## Memory - sessions write it, you delete it

Below the skills section is the `Memory` section. One row is one concept. A row shows the
filename and the first line of the body, and pressing it unfolds the whole thing right there.
That is all there is. There is no add and no edit, only `Delete`.

It is that way because what writes it is a session rather than a person. A session that
finished a ticket looks into its own persona's memory just before writing the result. If
something it found out this time would have saved the next session time had it known it in
advance, it leaves one sheet; if there is nothing, it does nothing. If a profile is "this is who
you are", memory is "here is how it went when I tried it here". It is not writing that anyone
sits down to do, so there is no box for a person to fill.

One concept per file, and the filename is the name of the concept. Learn the same thing again
and it rewrites that file instead of making a new one. That is why memory grows only as fast as
the number of concepts.

- `Memory n` is added to the list row. At zero sheets that meta does not appear and the section
  stays empty, with one line saying only whose job it is to fill.
- **What rides in the prompt is not the body but the location.** The directory path and a few
  lines on how to search it, and that is all; the session greps that directory with the
  ticket's own words and opens only the files it needs. Sheets pile up and the prompt stays
  where it is.
- The number at the section head is the size of this whole directory, and the 150,000 B
  retrospective budget appears behind it (`AGENTS.md`). It is separate from the budget on the
  list row. It is not a share that rides in the prompt.
- It is per persona and it is inside the project. Change workers and the same persona gets the
  same memory, and it follows the project when you move it. It is not a value that stays on
  this computer only.
- It does not care which engine. This is where it parts from skills. A skill is a notion that
  exists on claude only, but memory is what was found out in this project, so it is true on any
  engine.
- No profile, no memory either. Same reason as skills.

**What is wrong, you delete.** Nobody inspects what a session left. One wrongly learned line
stays in that directory too, and until it is deleted the sessions after it keep reading it.
Press `Delete` at the right of the row and it shows you the path of the file it will delete and
asks you to confirm. It cannot be undone. This screen has no add, so there is no way to stand a
deleted one back up. When you cannot tell whether to delete it, look at the end of the body. A
session is required to write the hash of the ticket where it learned the concept on a
`출처:` line, the source line. Press that hash and the ticket opens, so you can trace back what
work the sentence came out of (hashes and P-numbers, in [The screens](/docs/screens)).

If you want to edit by hand, open the file directly at `personas/<name>/memory/` in the queue.
The screen does not block that path. Still, this section is a place sessions fill. Put the
sentences you write yourself in the profile.

## How the prompt is assembled - where the profile rides

When one ticket is dispatched, a prompt is assembled once. The order goes like this.

1. **The core protocol.** The document holding a ticket's life and the queue's invariants.
   Neither the persona nor the project chooses it, and where it disagrees with a project
   document, this one wins.
2. **The persona.** The profile body, then the skills list behind it, then the memory. If
   `persona:` is empty this whole block drops out.
3. **The ontology.** A few lines on where the facts this queue has piled up are and how to find
   them. Same method as memory, and unlike the persona, every session gets it
   ([Archiving and the ontology](/docs/ontology)).
4. **The collaboration protocol.** `AGENTS.md` goes in whole. The ticket does not choose it and
   everyone gets the same thing.
5. **The ticket instruction.** One line asking the session to take a look at ticket `<hash>`.
   **The ticket body is not in the prompt.** The session opens the file itself by that hash. So
   however long a ticket gets, the prompt does not get heavier, and when a profile gets longer,
   it does.
6. **Reference context.** The list of document paths the worker settled on is attached at the
   tail. Not file contents but paths and a one-line description, and a path that does not exist
   is skipped ([Worker environment variables](/docs/ref-env), `TICKET_CONTEXT`). After that,
   one paragraph deciding which language to answer in is attached last.

The only four that ride in whole are the core protocol, the profile, the skills list, and
`AGENTS.md`. The rest give the location and the session opens them itself when it needs them.
The profile and the skills list are among those four expensive ones; memory is not. What the
budget on the list row adds is those first two and nothing else. Read that number straight as
the weight of the prompt.

## When an edit takes effect

Profile or skills, press `Save` and the file changes at once. Delete a memory and that file is
gone from where it was. A session running right now, though, has already received its prompt. A
prompt is assembled once, at the moment of dispatch, and a session already running does not
know the file changed afterward. What you changed rides **from the next ticket dispatched
onward**.

If you have something to say to a running session right now, that is somewhere else. See
[Talking to a running session](/docs/barge-in).

Next is [Squads](/docs/squads).
