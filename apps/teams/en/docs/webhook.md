# Sending Awaiting answer somewhere else

When a ticket starts waiting on an answer, that one fact can go out of the app. Put an address
into `Webhook` under `Settings` and every new Awaiting answer goes to that address. Point it at
Slack and a line appears in the channel.

It goes one way. Things leave, and there is no place for anything to come in (the last section of
this chapter).

## Adding the address

Open `Settings` with the gear at the top right and pick `Webhook` in the left-hand tree. If you
would rather not go through the tree, type `webhook` in the search box.

1. Put the receiving address into the `Address` field and press `Save`. For Slack that is the
   channel's incoming webhook address. You do not install an app or make a bot. One address is
   all of it.
2. If it does not start with `https`, the save is refused and `Only https addresses are accepted`
   appears. The file does not change. The address is itself a secret (§The address is a secret,
   below), so it cannot travel in the clear.
3. Once saved, the line below it changes from `Not sending` to a **masked summary**. What is left
   is the scheme and the host, and everything after that folds into `/…`. The address is never
   drawn in full again.
4. Press `Send test`. If `Sent` appears, one message really did land at that address. If it could
   not get through, `Couldn't send - <host> <reason>` appears in the same place. With no address
   saved the button is disabled, because there is nowhere to send to.

What `Send test` sends is the first Awaiting answer ticket at that moment. If there are none, a
set of placeholders goes out, so the button works on a queue you just made. **A test does not
consume the real event.** Even if a ticket that has not gone out yet rode along in a test, its own
line goes out once more when its turn comes.

To turn it off, empty the field and save. The line goes back to `Not sending`.

## When it goes out

- **One line per new Awaiting answer.** The app checks every 15 seconds.
- The same ticket goes once. Three days sitting in Awaiting answer is still one line.
- **Whatever was already up when you opened the app does not go out.** The first check only
  writes down quietly what is awaiting an answer right now, and it sends from what appears after
  that. If a backlog poured out every time you opened the app, you would mute the channel next
  week. Anything that appeared while the app was closed stays in for the same reason. The backlog
  is up in the bell and on the board.
- What has already been answered and released does not go out. Writing an answer takes it out of
  the bell, but that fact does not follow it outward.
- **Awaiting answer and nothing else.** The other six items in the bell do not go out. It is the
  one state where a person has to write an answer before that queue moves again ([The
  screens](/docs/screens) §The notification bell).

## What goes out

One `POST`, `content-type: application/json`, and a body of five keys.

```json
{
  "text": "Awaiting answer: The manual talks about webhooks - dira GUI (1ce93426)",
  "project": "dira-gui",
  "hash": "1ce93426",
  "title": "The manual talks about webhooks",
  "at": "2026-08-20T01:26:23.000Z"
}
```

The one `text` field holds the title, the project and the hash together. Slack and its like draw
their line from that key alone, which is why an address on its own gets you a readable line. The
project name there is the name you see on screen. If the board says `dira GUI`, `dira GUI` is
what reaches the channel. The `project` field is a different thing. It is the slug fixed at
registration and used in the address (`dira-gui`), so it does not follow a later rename. **The
field a person reads is `text`, and the field code tells projects apart by is `project`.** The
language of the sentence follows `Language` in `Settings`. `at` is UTC.

**What does not go out** is this. The ticket body, the `## 질문 n` (the question section) and its
options, the answer a person wrote, the queue root path, persona and worker names, tokens, and
the ticket filename. Those five fields are all of it. So receiving this line does not let you
open the ticket. The hash is a value a person matches up by eye, not a link. The address the
receiving end would open is `localhost` on this computer, which does not open from anywhere
else.

## The receiving end - what works and what does not

| Receiving end | How it looks |
|---|---|
| Slack | the line appears as it is. That end reads `text` alone, so attaching it is the whole job |
| Discord | no line is drawn. The key that end reads is `content`. The request itself arrives and the JSON is kept as it is |
| Lark, DingTalk, WeCom | **they do not take it.** They want `msg_type` or `msgtype` and a nested object, so this body draws nothing. Do not attach one and sit waiting |
| a server or script of your own | works. Read the `POST` body as JSON and answer within 5 seconds and you are done |

## The address is a secret

**Anyone who knows that address can write in that channel.** No signature header and no token is
attached. The one address is the key. Whoever gets that line can put messages in that channel
without this app.

- **Do not hand it to anyone.** Paste it into an issue, a screenshot, a commit or a chat and that
  channel is open. This is why the screen never draws the address in full again after you save
  it.
- **There is one file, `~/.config/dira/webhook.json`, and its permissions are `0600`.** Only the
  owner of this computer reads and writes it. It is not kept inside the queue (`.dira`). The
  queue sits in the project folder, where committing, backup and syncing all reach it, and two
  computers opening the same queue would sometimes send the same event twice.
- It is a setting on this computer and there is one address. Every registered project uses that
  same address. Which project a line came from is what `project` in the body tells you.
- The full address is not written into the logs either. What a failure line carries is the host
  and no more.

To delete it, one line does the job. It gives the same result as emptying the field on screen and
saving.

```bash
rm ~/.config/dira/webhook.json
```

## When it could not send

- **It does not send again.** One event, one attempt. If the address was wrong or the receiving
  end was down, that ticket's line never arrives. Fixing the address does not bring the missed
  ones along.
- **You do not lose the fact, though.** Awaiting answer is a state. `Tickets waiting on an
  answer:` in the bell, the board, and the desktop notification all keep saying that ticket.
  The webhook is a second channel, not the original.
- The screen does not tell you about a background failure. No item is added to the bell. What did
  not go out does not block the queue, and what a person has to act on is already up in the bell.
- What is left is one line in the server log. It is printed to the terminal you started the app
  from, in the form `[dira] 웹훅 실패: <host> <reason>` - webhook failed, with the host and the
  reason (a different place from the queue logs in [Reading the logs](/docs/logs)).
- **Whether the address actually reaches is something a person finds out by pressing.** The one
  place that call gets made is `Send test`. If you changed the receiving end, press it once and
  move on.

## There is no incoming webhook

Nothing outside can wake this queue. This app has no port that listens, because it does not stand
up as a server that takes requests. There is no way to send a command from Slack to make a ticket
or open a session either. The doors a ticket comes in by are two: the screen, and a file in the
queue folder.

Next is [Closing](/docs/closing).
