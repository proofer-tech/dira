# Squads

Write `persona: developer` on a ticket and developer does that work. Whoever wrote the ticket
has already decided who. But there are also tickets where whose job it is only becomes clear
after someone has taken the work in hand.

A squad is a way to hand that decision over as well. You group a few personas under one name
and put that name on the ticket. That ticket goes to the group's **leader**. The leader does
not do the work. It reads the ticket, decides who will do it, and issues a new ticket to that
member.

## Where it parts from a persona

A squad has no profile. No skills, no memory, no color, no cap. Two files inside
`<queue folder>/squads/<name>/` are the whole of it. `members`, which lists the members, and
`rules`, which the leader reads when it chooses. The second one is optional.

That is because a squad is not an identity. A profile is the writing that hands a session who
it is, and that is still the persona's share ([Personas](/docs/personas)). What a squad decides
is two things. Who receives this ticket, and what that person looks at when dividing it up.

**The name on the first line is the leader.** `members` is a file where the order carries
meaning. The top line is this squad's leader, and a ticket that carries the squad goes to that
one person only. The rest of the members have nothing to do with that work until the leader
issues them a ticket.

## A new project has default

Create a project and one squad is laid down with it. Its name is `default`. Open the `Squads`
screen and that one row is already at the top of the left list. It is also the row picked
first.

There are four members. `pm`, `developer`, `qa`, `designer`. Five personas come with the
project, and `archive-manager` alone is left out. A leader has no occasion to pick that
persona. The session closing a ticket calls the name directly when it issues an archive ticket.

The leader is `pm`. That is the first-line rule as it stands. `rules` is not laid down, so pm
decides whose job it is from the member names and the first line of each profile, nothing more.
If you want to give it a basis for choosing, write it in `Rules` in the right column.

Open the dialog to issue a ticket and the assignee field already has `Squad default` picked.
Issue it as it is and that ticket goes to pm. pm reads it and then issues a ticket to a member.
If you already know who will do it, pick a persona in that same field. To attach nobody, use
`None` at the top. Delete `default` or rename it and that field opens on `None` from the start.

**It is not created on a project already running.** Scaffolding lays files down only when it
makes a new queue. It does not overwrite a file that is already there. To stand one up on a
project you have been using, make it yourself as in Making a squad, below. Name it `default`
and the default selection in the issue field follows along.

## Making a squad

Go to `Squads` in the header. It is the same screen as personas. At the entrance where you used
to make a persona, one more field has been added for choosing what to make. Pick squad there.

The naming rule is the same as for a persona. Letters, digits, `-`, and `_` only. And it shares
its names with personas. Try to make a squad by the name of a persona that already exists and
it is refused, and the other way around too. Because the two use one namespace in the left
list, a name collision would leave no way of telling which row is which.

Once it is made, that row appears in the left list. The row stacks the members' color dots and
carries the name and `Members n`. A squad has neither a color of its own nor a size on the row.

**Where it appears is decided by `Group view` at the top of the list.** With it on, squads are
top level and the member names come out only when you unfold the row. Turn it off and it
appears inside the `Squads` group with no children to unfold. Members are then seen by picking
the row and looking at the right column. It is on by default. Turning it off is not saved, so
refreshing turns it back on ([Personas](/docs/personas)). While you are working on squads,
leaving it on is easier. Who is in what shows straight from the list.

Delete every squad and only personas are left, so the list goes flat and `Group view` goes with
it.

## Choosing members

Pick a squad row and the right column opens. It is shorter than a persona's column. Two
sections, `Rules` and `Members`.

Inside the `Members` section it splits in two again. `Leader` on top, `Members` below. One card
goes in the leader spot and everyone else appears below. **Adding is the `Add` at the group
head, removing is `Remove` on the card.** Those two are the whole of deciding who belongs. Once
you have picked them all, `Save` at the bottom of the section.

Press `Add` and a list of names unfolds right there. `Search names` sits above it, and a few
letters narrow it down. The `Add` in the members group shows only personas not yet in this
squad. A name you pick is appended after the member list.

A persona with no profile does not appear in that list. That is a persona whose name is on a
ticket while the file does not exist yet. You have to make the profile before you can put the
name in as a member.

If the profile of a name you had put in as a member disappears later, that name stays at the
very bottom of the members group wearing `No profile`. It is one line rather than a card, so it
has no color dot and no role field, and the only thing you can do to it is `Remove`. Wiping it
out along with the save would make a name a person put in disappear without a sound. So we
picked the side that makes a place for it and shows it.

You can also save with no members left at all. The member count on the left row shows 0. What
becomes of a ticket carrying that squad is in How the engine starts the leader, below.

**The one handle for deciding the leader is the `Add` in the leader group.** That list is split
in two. `Members` on top, the names in this squad now. `Not in this squad` below. Raising one
member to leader and bringing someone in from outside both finish in this one list. The card
does not carry that handle.

**A name that comes down from the leader spot leaves the squad.** It does not stay as a member.
The text you wrote in its role field goes as well. That is why **swapping the leader while
there is one already brings up a confirmation first.** The head is `Remove leader —` with the
name that will leave behind it. The body tells you that name leaves this squad. If there was
text in the role field, one more sentence about that going too is added. Press `Cancel` and
nothing changes. It changes only if you press `Remove`.

It asks even when the role field is empty. What the confirmation guards is not the text you
wrote but the name that disappears. Two places do not ask. Seating the first leader on
`No leader` has no name to lose, and `Remove` on a member card is not the leader spot.

To keep the previous leader as a member costs one more move. Pick that name again from the
`Add` in the members group.

`Remove` on the leader card follows the same rule. That name leaves the squad and `No leader`
appears in the empty spot. It is a state that exists only before saving. Save and the first
line of that file is the leader again. The name that was at the top of the members group takes
that spot. Refresh the screen and that name is showing as leader.

What you are looking at is **what the file will become if you press save**. Until you press it,
the file does not change.

**The role goes on the card's second row.** Write in one line what this person does in this
group, like `Owns the screens`. Leave it empty and the first line of that persona's profile
shows through in gray. Saving does not put that sentence into the file, and when the leader
receives it, the first line of the profile fills that spot instead. Which means there is no
obligation to write the role again for every squad. The `Add` list has no such field. The role
of a name not in the squad has nowhere to be saved.

**Member names are pressable.** Press the name on a card's first row and the right column
changes to that persona's detail. There is no digging back through the left list to see what is
written in a profile. That name gets picked on the left as well, and this squad stays unfolded.
Hover and the name gets an underline. That is the only sign that it is pressable. Tabbing to it
and pressing enter opens it too. The leader card is the same.

The name on the `No profile` line at the very bottom is not pressable. It is a name with no
detail to open, so it gets no underline either.

The way back is the browser's back button. Press it once and the address returns to this squad
and the right column returns to the detail you were just looking at. Picking this squad's row
in the left list again does the same. **A half-written thing is not lost.** Put text in a
role field, leave without saving, come back, and that text is still there. `Unsaved` stays on
the left row while you are away, too. With nothing to lose, no box asks whether you really mean
to leave.

**What the leader looks at when it chooses goes in the `Rules` field above.** It is free prose
with no syntax, and the engine only reads it and hands it to the leader. Leave it empty and
save and the file goes away entirely. Then the leader decides from the member names and each of
their roles, nothing more.

The two values are laid at `squads/<name>/members` and `squads/<name>/rules`. `members` is
`<name> <role>` per line and it cuts once at the first space, so the role side may be a
sentence. You can also edit it in an editor directly. **The screen does not re-sort the order.**
Save and the names that were already there stay in the order the file has them, and only the
names added this time are appended after. A first line held from the file does not change
because you saved on screen. The one thing that moves the order is the `Add` in the leader
group. The name you pick there goes to the file's first line.

## Putting a squad on a ticket

Write one `squad:` line in the ticket frontmatter. The value is one squad name. It is not
written as a list the way `deps:` is. One ticket belongs to one squad.

```
---
ticket: 3f9a12c4
title: The login screen margins are tight
kind: work
squad: frontend
---
```

You do not have to write it by hand. The [issue dialog](/docs/ticket-writing) and the edit form
on a ticket detail both pick it in the same field. The options in the field where you used to
pick a persona are split into two groups, personas and squads, and squads are the lower one. A
ticket has one assignee, so there is one field.

That is why `persona:` and `squad:` do not stand together. Pick a squad on screen and `squad:`
is written and the `persona:` line is erased. Pick a persona and it is the other way around. If
you edited the file by hand and wrote both, `squad:` wins.

## How the engine starts the leader

At the very moment it picks a ticket, it reads the first line of `members`. Three lines are the
whole of it.

| The state of the queue then | What happens |
|---|---|
| The leader is not at its own cap | The leader takes that ticket |
| The leader is at its own cap | Nobody picks it up. Even with other members idle, it does not pass to them. The ticket stays in the Open lane until the leader spot frees up |
| No squad by that name, or its members are empty | It leaves one `WARN` line in the log and goes down the old path. If `persona:` is still there, by that value; if not, without a persona |

**When the leader is blocked, the whole squad stalls.** That is a chosen value, not a fault.
Whom to give it to was handed to one person's judgment, so when that person is busy, no
judgment comes out. If it blocks often, raise the leader's cap
([Personas](/docs/personas)) or change the first line of `members` to a less busy persona.

Not passing it on while members are idle is also the value that keeps one ticket from splitting
across two people. Whether the leader looks at it late or early, the person dividing that ticket
up is one.

In the order of `members`, the only line that carries meaning is the first. From the second line
on, the order decides nothing.

## What the leader does

What a leader session receives is its own profile, skills, and memory with **one squad block**
added. The squad name, the names of every member and each of their roles, who the leader is,
and `rules` in full.

The leader reads `## Goal` and **issues a ticket to a member.** It is a new ticket with that
member's name in `persona:`. Then it writes in the `## 결과` (the result section) of the ticket
it was holding who it issued what to, and closes it. **Closing without one line of code having
changed is normal.** What the leader did was decide, not work.

So one squad ticket costs one more session and one more ticket. That is the price of handing
over the judgment. For work where who does it is already settled, writing `persona:` from the
start is shorter.

If a ticket the leader issued carries `squad:` again, a leader starts again. The engine does
not stop this.

**Members know which squad they are in, too.** A persona in a squad always receives that block
in its prompt. It does not matter whether the ticket it is holding right now carries `squad:`.
The point is to work knowing your own role and the role of the person beside you. `rules` goes
to the leader only.

## The cap, and the record

**The cap that catches here is the leader's.** A cap is a value set per persona and a squad
has no cap of its own. If the leader is developer and developer's cap is two, that squad's
tickets do not come up while developer is already holding two. Coming in by way of a squad does
not make a third.

The engine does one more thing at the moment it picks the ticket. **It writes the leader's name
into `persona:`.** So that session is counted exactly like an ordinary persona ticket. The
persona column on the board card, the color dot, the `owner:` line, the profile riding in the
prompt: not one spot differs.

While nobody has picked it up yet, the board shows the `squad:` value instead. No color dot is
attached. A squad has no color. The moment it is picked up, that spot turns into the leader's
name.

**Why a ticket went to that persona shows when you put the two values side by side.** `squad:`
stays in the file as it is, and `persona:` is that group's leader. Read the two together in the
frontmatter table on the ticket detail.

`persona:` is a record, not an instruction. It is not erased when a session ends and the ticket
is reclaimed, and the next dispatch resolves it again and overwrites it. To fix it on one
person, delete the `squad:` line.

## Deleting a squad

That is `Delete` at the head of the right column. The `squads/<name>` folder is deleted and it
cannot be undone.

The `squad:` value on tickets carrying that squad stays as it is. It is not deleted along with
it. The next time that ticket is dispatched, one warning line is added as in the third row of
the table above and it goes down the old path. If all you want is to change the name, make a
new squad, fill in the members, and move the value on the tickets.

Next is [Protocols](/docs/protocols).
