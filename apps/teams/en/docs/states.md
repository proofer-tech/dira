# The states a ticket passes through

The board has three lanes. Open · In progress · Done. Those three pair up exactly with three
files. That is why there is no handle for dragging a card between them. A lane is not a slot a
person decides on; it is **a drawing of a filename suffix**.

| Board lane | File | What it means |
|---|---|---|
| Open | `<hash>.md` | Open, and a candidate for the next tick |
| In progress | `<hash>.wip.md` | Somebody claimed it |
| Done | `<hash>.done.md` | Finished |

Those three are all the states there are. When a worker claims a ticket the filename gains `.wip`
and the card moves to the lane on the right. When the session ends by changing it to `.done`, it
goes one lane further. The app reads that file and draws it; it does not make the state.

The suffix strings themselves are changed with the environment variables `TICKET_INPROGRESS` and
`TICKET_DONE` (defaults `.wip` and `.done`; see [Worker environment
variables](/docs/ref-env)). Whatever strings you use, the decision works the same way. It looks
only at whether the filename ends with that string.

## Done that closed unfinished

The done badge comes in two shapes. `Done` and `Done (continued)`. The file is the one shape,
`<hash>.done.md`, in both cases; what splits them is whether there is a `continued:` line at the
top of the ticket. It is not that there are now four states.

`Done (continued)` is **a done that closed by handing the rest to another ticket.** When a
session decides it will not get this ticket all the way finished, it does not die on the spot. It
leaves what it got done and opens one new ticket for the remaining scope. It writes that hash
into its own `continued:` and closes as done. So a ticket wearing this badge has `Done when`
items left unticked. Those are not spots the session missed. The follow-on ticket inherits those
items as they stand.

**The badge itself is the link to that follow-on ticket.** Press it to jump across and the
remaining scope is in that ticket's `## Goal`. If the hash written in `continued:` is not in the
queue, the badge appears without the link.

**The chain catches at three.** A handoff ticket carries which number it is in a `handoffs:`
line. One after the original, then two, adding up one at a time. At the fourth, the worker that
claims the ticket puts it straight back down and locks it as awaiting an answer. The point is to
get a ticket that has been passed on and on with nobody finishing it in front of a person at
least once. Write an answer and the lock comes off, and the same ticket does not hit this ceiling
again.

The badge shows in the status column of the board table and next to the title on the ticket
detail. The status filter does not have this split. Pick `Done` and both come out.

This is not the [follow-up](/docs/screens) a person opens by writing a line on a done ticket.
That one only reads the original, so the original's badge stays plain `Done`.

## Three markings that are not lanes

The lanes draw the steps a ticket passes through. But among the tickets sitting in `Open` there
are some that cannot move on when their turn comes. It is not one more step so much as a
circumstance inside that step, so instead of stretching the lanes to four, a marking goes on the
card to tell you.

**`Blocked` — the orange `deps` tag.** A prerequisite ticket has not finished. The unmet hashes
show on the card in orange and the ticket stays exactly where it is in the `Open` lane. Being
stuck does not push it to the bottom. Pushing it down would make the cards above it lie about
being "dispatched soon." **There is nothing for you to do.** The moment the prerequisite
finishes, the tag disappears and that ticket becomes a candidate, with nobody touching it.

**`Awaiting answer` — a badge and the days elapsed (`Awaiting answer · 3d`).** The session asked
a person something and took its hands off. There are two places the engine locks a ticket even
when the session did not ask: when automatic reclaim has failed three times, and when the handoff
ceiling above is hit. Either way that ticket is locked until an answer exists as a file, so no
worker picks it up. It is a lock put there to keep from burning sessions on the same question
over and over. There are three places to write an answer and one form between them. In the
`Progress record` box on the ticket detail the input field comes up in answer mode. On the board
card it opens as a dialog, and the notification bell in the header carries a `Write an answer`
link. Wherever you write it, the app makes one `kind: answer` file. The instant that file is
born, the lock comes off and the badge goes back to `Open`.

The days elapsed ride along on the badge to make neglect visible. Nothing expires and nothing
cancels on its own. An old `Awaiting answer` is a sign of a stall. That call is a person's.

**`Polling` — a badge and the time left (`Polling · 3h left`).** This ticket is waiting on a
condition outside the queue. Waiting for a build to end, for another team to fill a value in.
The session hangs one script that decides the condition on the ticket and takes its hands off.
After that, every time a worker wakes it runs the script on the ticket's behalf, and when the
script says the condition has arrived, the badge disappears and the ticket becomes a candidate
with nobody touching it. It does not hold a worker slot while it waits, either.

**What splits this from `Awaiting answer` is whether there is an answer for a person to write.**
`Awaiting answer` never comes undone until a person writes one. `Polling` has no answer for a
person to write. Whether the condition arrives is something happening outside the queue, and when
it does, it comes undone by itself. So when you see this badge there is usually nothing for you
to do.

The one `Open` lane holds `Blocked` and `Awaiting answer` and `Polling` side by side. What splits
the three without opening a card is the word on the badge.

**What it is waiting for, and why, is the one line under the badge.** It is one sentence for
people to read — waiting on an outside build to finish, say — and it gets cut where the card ends.
Open the ticket and the same sentence sits in the `Reason` row of the `Polling` section.

That line comes out of the ticket body. The screen copies **the first line of the last `## 결과`
section**, the results section. The session that hangs the wait and takes its hands off writes it
there in one sentence; that is the protocol. On a ticket that has waited more than once, the
sentence from the last round is the reason now. On a ticket where the protocol was not followed,
the line simply does not appear. The card carries only the badge and the detail has no `Reason`
row.

The condition itself is not written on the card. The reason is a sentence a session wrote; the
condition is what the script decides, and they are not the same thing. Boiled down to one line,
it gets confusing which of the script and that line is the real one. The body of the script
appears whole in the `Polling` section of the ticket detail. The interval and the deadline, the
last time it ran, and the last output are all there with it.

`Polling` has an end fixed to it instead. The time on the badge tells you how much is left before
that deadline. Past it, the badge turns into **`Deadline passed`**, and on the next tick the
engine stops polling. As it does, it moves that ticket to `Awaiting answer`. What it was waiting
for and what the last poll saw get quoted into the question. There are three things to choose
from: extend the deadline and wait longer, dispatch it now regardless of the condition, or close
this ticket. The field for writing your own is underneath, as on any question. Three polling runs
ending in an error in a row come up in the same place.

If you would rather not get that far, break the wait before the deadline. `Dispatch now` and
`Extend deadline` always sit in the `Polling` section of the ticket detail (see
[The screens](/docs/screens)). Neither handle makes an answer file. Nobody asked a question, so
there is no answer to write.

`Blocked` and `Awaiting answer` are options in the board's status filter as well. There are six
filter options against three lanes, and that is correct. The filter is where you pick a state the
engine knows about; the lane is where the steps of the flow get drawn. `Polling` is not among the
six. The engine still counts this ticket as an open one, so the filter catches it under `Open`,
and what it is waiting on right now is what the badge and the line beneath it tell you.

## Tickets that never get dispatched

There are five reasons a ticket sits open with no worker claiming it. The three above — `Blocked`
and `Awaiting answer` and `Polling` — are **normal.** They open by themselves when the outside
condition clears.

The fourth is normal too. **Priority 1 is a candidate only while zero tickets are in progress.**
If anything else is running, its turn comes and it gets skipped, and when that session ends it
becomes a candidate again with nobody touching it. No badge, no tag. The only marking is the
priority meter on the card standing at one notch. A 1 that has inherited a higher value comes up
at that value and does not catch on this gate (see [Writing a ticket
yourself](/docs/ticket-writing)).

Only the fifth is an accident. **An open file with a `session_id` written in it** (the badge
reads `Assigned`), a combination the engine does not make. It happens when a person wrote
`session_id` into the file by hand, or copied a ticket holding that value wholesale into a new
ticket. Then this follows.

- The side that picks candidates sees a `session_id`, takes it as already assigned, and skips it
  permanently.
- The side that reclaims dead sessions looks only at `.wip`. This ticket is not `.wip`, so it is
  not up for reclaiming either.

Neither claimed nor reclaimed, it dies quietly. A badge alone would mean never knowing unless you
opened that screen, so the app raises this **as an item inside the notification bell in the
header**: `Tickets no one will claim: <n>`.

- It shows wherever you are in the project. Put it on the board only and someone looking at a
  worker screen never knows.
- It cannot be filtered off and is not cut to a top few. Every affected ticket is listed and each
  row gets an `Unassign` button. What that button does is one thing: delete the `session_id`.
- There is no dismiss and no mark-as-read. The board re-reads the queue every five seconds, so
  when the count reaches zero the item disappears on its own. The app does not record "resolved"
  separately. The moment it did, there would be a second truth able to diverge from the fact in
  the file.

These tickets are in no kanban lane. So the board's ticket total can be larger than the lane
totals, and `Not dispatched: <n> — see notifications` is written in alongside it.

`session_id` and the other keys the dispatcher and the engine use are not values a person fills
in. Which keys exist and who writes them when is a table in [frontmatter
fields](/docs/ref-frontmatter).

## Why the filename is the lock

There is one reason the state lives in the filename instead of the frontmatter. **The rename is
itself the lock**, so several workers can watch the same queue without colliding.

A claim is `os.link` making `<hash>.wip.md` and deleting the original. If the destination already
exists, the kernel hands back `EEXIST`. Already claimed. **The decision ("not claimed yet?") and
the acquisition ("I claim it") are inside one system call**, so there is no gap for another
process to get in between. Of six workers looking at the same ticket at once, only the one that
linked first wins, and the rest move on to the next candidate. This is not a newly invented
lineage. It is the same as [Maildir](https://en.wikipedia.org/wiki/Maildir), which uses the
rename of a mail from `new/` to `cur/` as the lock.

On a filesystem with no hard links (a FUSE or SMB mount, Google Drive say) it falls back to
`O_CREAT|O_EXCL`. That is an atomic exclusive create too, so the property holds. Move the state
into the frontmatter and the gap between reading a value and writing it back is not atomic across
processes, and you have to buy a lock the filename was giving away.

Next is [Workers](/docs/worker).
