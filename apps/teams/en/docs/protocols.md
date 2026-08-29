# Protocols

The rules that go into a session prompt come in two layers. One is the core. The engine puts it
at the front of every session, and every project, not just this one, gets the same thing. The
other is the project protocol. That is what this screen edits. Who does the work is answered
separately by [Personas](/docs/personas).

The body of the project layer is one file: `protocols/AGENTS.md` in the queue. A persona is
chosen by the ticket and loaded, but nobody chooses this file. **Every session that runs in this
project gets the same document.** Persona or no persona, `claude` or `codex`, it is the same.

This file went up along with your first project ([Create your first
project](/docs/first-ticket)). What order a ticket gets finished in, where the result goes, and
what to leave behind when stuck are already written in it. The place to edit it is the protocols
screen.

## The protocols screen - the file tree and the editor

`Protocols` in the left nav. Go in and `AGENTS.md` is already open on the right. It is the file
you open most often on this screen, so it saves you the one choice.

The file list is on the left, the editor on the right. If the editor feels cramped, collapse the
list. The control is the small icon in the top right corner of the list, and hovering it shows
`Collapse the file list`. Press it and not one filename is left; only a small box holding that
icon stays to the left of the editor. The same place expands it again, and then it reads
`Expand the file list`. In a narrow window the collapsed list lies across the top of the editor
as a horizontal bar rather than down the left side. The icon is still at the right end.

The collapsed state stays in the address - `?sidebar=off`. Choosing a file or saving does not
expand it again, and if you copy that address to someone, they come in collapsed too. An address
without the parameter opens expanded.

The grey text under the title is the real path of the directory you are looking at. If that path
cannot be read from the worker file, it goes by the engine default (`<root>/protocols`) and
writes `assumed default` beside it.

The editor has two modes. It opens in rich text. Headings are heading-sized and tables are tables
with cells, and you edit what you see. To look at the markdown in the file directly, press the
icon button in the top right corner of the pane. Hover it and it reads `Switch to source`. Coming
back is `Switch to rich text`, in the same place. The mode you pick stays on this computer. Every
markdown field in this app opens in the same mode, whether it is a ticket body, the ontology, or
a profile. Switching modes does not lose unsaved edits.

Editing in rich text does not rewrite the whole file. Save and only what you changed changes; every
other line is identical down to the byte. These files are not read by people alone, they are read
by sessions. If table alignment shifted on its own or a notation like `<hash>` came out
different, the text a session reads would be different. Editing in rich text does not do that.

Change one character and `Save` lights up at the bottom right. To go back to before you saved,
press `Revert` beside it. Files that are not `.md` open in the same editor. What does not open is
a directory, a file over 1MB, and anything that is not text. In those cases the reason takes the
editor's place.

The project runs fine with no files at all. The engine skips over a missing `AGENTS.md`. No
error, no warning. The session just starts without knowing this project's conventions. The core
is loaded even then.

## The padlocks at the top of the tree - the core protocol

Three files with a padlock sit apart at the top of the tree: `CORE.md`, `CORE-TICKETS.md`, and
`CORE-MEMORY.md`. Here you only read. No saving, no renaming, no deleting.

**The contract the engine reads is in there.** That the filename is the ticket state, that a
claim is an atomic link, where `## 결과` (the result section) and `## 블록` (the block section)
go. A session that breaks these sentences does not merely produce different work, it breaks the
queue. That is why they were not put anywhere a project can reach.

Each time you select one, its real path appears above. It is one of two places.

- **`protocols/` in the engine repository.** The queue has no copy, so there is nothing to
  delete.
- **`protocols/` in this queue.** Making a new project through the app copies the core into the
  queue. Then what sessions actually receive is the queue's copy, so the screen shows that one.

Where the project document contradicts the core, the core wins. The core comes first in the
prompt and carries that precedence in one line at its head.

Of the three, only `CORE.md` is inlined into the prompt. The other two are read by the session
itself, at the moment `CORE.md` points at them. Ticket frontmatter syntax is in
`CORE-TICKETS.md`, and the format for leaving a retrospective is in `CORE-MEMORY.md`.

## The `Inlined in every prompt` badge

Two files in the whole tree carry the badge: `CORE.md` at the top and `AGENTS.md` in the project
layer. Everything else reads `Read when a session needs it`. This is the most important
distinction on this screen.

- The badge reads like `3,496 / 3,500 B`. The first number is this file's size right now, the
  second is the budget. The unit is bytes, so it is the same number `wc -c` gives you in a
  terminal. The first number moves as you type. Telling you after you saved would be too late.
- The budget differs per file. `CORE.md` is 3,500 B and `AGENTS.md` is 6,500 B. Go over and the
  word `over` appears after it. The color does not change and saving is not blocked. Being over
  is not itself a violation. What catches you is writing more while you are over. At that point,
  delete more bytes than you add.
- Length is the cost of every session. Write 100 more lines here and those 100 lines go into the
  prompt of every session from now on.
- The engine reads one name, `AGENTS.md`. Making one with the same name in a subdirectory does not
  get it inlined.

The assembled prompt goes in this order. `CORE.md` first, then the persona profile and the
ontology block, then this file, and the ticket instruction last. The further along, the more
specific.

## What goes in it - the rules for handling the queue

What gets built is decided by the ticket, and how it gets built is decided by the project's spec
document. This file takes the space between them. **It is what everyone does the same way, every
time, from taking one ticket to finishing it.** What it ships with is the example.

- Which directory a session runs in. Whether each worker uses its own git worktree
- What it fetches on starting, and where the result goes when it finishes
- The procedure for backing off on hitting an account limit
- The total a persona may accumulate in memory
- Whether to issue an archive ticket when finishing one ([Archiving and the
  ontology](/docs/ontology))
- How to start a browser

What does not go in it is just as clear. An instruction that applies to one ticket goes in that
ticket, and a criterion that applies to one role goes in the [Personas](/docs/personas) profile.
The syntax for handling the queue is already in the core, so do not copy it over. Leave in this
file only the sentences everyone has to read every time.

## When to move something into a neighboring file

When it feels long, move the details into a neighboring file. A newly made project already stands
up `tickets.md` and `ontology.md` that way: the criteria for splitting tickets, and what to write
into the ontology and how. All of it is needed only while doing that particular job, so
`AGENTS.md` merely points at it in one line.

Moving it changes two things. The prompt every session takes shrinks by that much, and the
session actually doing that job still reads the whole thing. In the tree, that file reads
`Read when a session needs it`.

The criterion is one sentence. **If every session has to know it, `AGENTS.md`. If it is needed
only for some particular job, a neighboring file.** Nesting directories is fine.

## New file, rename, delete

`New file` is at the top right of the screen. Fill in the one path field and an empty file is
created with the editor opening straight away. Put a `/` in and it creates the subdirectories
too. A path that leaves the protocol directory (`../` or an absolute path) is refused by the
server.

`Rename` and `Delete` are at the top right of the editor, across from the filename. Renaming
changes the path, so it is also how you move something into a subdirectory. An existing name is
refused. Nothing is overwritten quietly. Deleting cannot be undone.

**`AGENTS.md` shows you a warning first, for both.** Try to rename it and
`Rename it and it drops out of the prompt` appears in the dialog; try to delete it and
`Every session will start with no collaboration protocol` does. It is because the engine reads
one name. The moment the name differs, that file becomes just another neighboring file and
sessions start without the rules. No error is raised, so there is nowhere to find out except the
screen telling you beforehand.

## When an edit takes effect

Press `Save` and the file changes right there. But the session running now already has its
prompt. The prompt is assembled once, at the moment of dispatch, and however the file changes
afterwards, the running session does not know. Edited rules take effect **from the next ticket
dispatched.**

If you have to tell a running session something right now, that is somewhere else. See [Talking
to a running session](/docs/barge-in).

Next is [Archiving and the ontology](/docs/ontology).
