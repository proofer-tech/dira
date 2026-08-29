# Privacy Policy

> The Korean version of this document is the authoritative text. This English page is a
> reference translation, and where the two differ the Korean version governs.

Proofer Inc. (프루퍼 주식회사, "the Company") runs dira, the engine and the app together, and
handles personal information as set out below.

## 1. Purposes of processing

The Company looks at whether anyone actually opens the app (`dira teams`) and where they stop
partway through onboarding. It counts how many installs are running and a handful of screen
actions. Not even the Company knows who is using it.

The website carries one support chat widget. Questions that arrive through it get an answer,
and when the same person asks again, the earlier conversation is there to read.

## 2. What is processed

The app has no login and no account. It does not identify a person - it counts one install,
anonymously.

| Item | What it is | Where it lives |
|---|---|---|
| Install identifier (`install_id`) | A random UUID naming this one install on this Mac. Sent as the GA4 `client_id` | `~/.config/dira/analytics.json` |
| Session identifier (`session_id`) | One stretch of using the app after you open it. Sent as the GA4 `session_id` | The server process's memory (nothing is written to a file) |

Neither value is tied to a name, an email address, or an account. The events that ride on
these identifiers are the eight below and nothing else.

| Event | When | Parameters |
|---|---|---|
| `app_open` | A user session starts (before the first event, and again after 30 minutes of no activity) | `app_version`, `shell` (`desktop`\|`browser`) |
| `screen_view` | A screen opens | `screen` (`root`\|`board`\|`ticket`\|`workers`\|`personas`\|`protocols`\|`home`) |
| `project_add` | A project was added | `method` (`create`\|`register`) |
| `worker_create` | A worker was created successfully | `engine` (`claude`\|`codex`\|`other`), `cron_ok` (bool) |
| `ticket_create` | A ticket was issued, or a request submitted, successfully | `kind` (`work`\|`request`\|`feedback`) |
| `answer_submit` | A person wrote the answer in an answer round trip | None |
| `feedback_submit` | `Open a GitHub issue` was pressed in the `Send feedback` dialog | None |
| `analytics_off` | Analytics is turned off (one last event, just before it goes quiet) | None |

The values are counts, booleans, and enums fixed in advance. There is no free text anywhere
among them.

The website this page belongs to, `dira.proofer.tech`, collects visit totals through Vercel
Analytics without cookies. Those totals are page views counted by path, and they do not
identify an individual visitor.

Opening this page makes the support widget send a request to Channel Corporation's servers. A
record of the visit remains even if you never open the chat window: your IP address, the
region that address suggests, the date and time, and your browser and device.

Open the chat window and what you write there is added to that: the question itself, and any
name or contact detail you leave so a reply can reach you. This part is free text, so
the Company does not decide in advance what goes into it. Leave out whatever you would rather
not write, and ask anyway.

## 3. What is never processed

None of the following goes into any parameter of any event.

File paths, project names, queue roots, ticket hashes, ticket titles, ticket bodies, persona
names, agent output, account information, source code.

This is not a promise in prose but the means of carrying it out. The
[`Events` type](https://github.com/proofer-tech/dira/blob/master/apps/teams/lib/analytics.ts)
that defines the events and their parameters closes the table, so a name or a parameter that
is not in the table fails to compile. The code has no way to slip a new value out.

Everything up to here is about the events the app sends. The website's support widget leaves
the visitor's browser directly without passing through the app, so it stays outside this
table. What rides on the widget is in section 2.

## 4. Cookies

The app plants no cookies. It does not use `gtag.js`; the server sends events straight to
Google Analytics 4 over the Measurement Protocol. Vercel Analytics, which the website uses,
is cookieless as well.

There is one cookie, and it is on the website: `_dd_s_v2`, planted by the support widget.
Channel Talk watches the widget's errors and performance with that value. It tells one
browser session from another and is not tied to a name or an account. The cookie appears even
if you never open the chat window. To shut out the widget entirely, block requests to
`cdn.channel.io` and `api.channel.io` in your browser.

## 5. Retention and deletion

How long GA4 keeps something depends on what it is (checked in the GA4 console on
2026-08-02).

| What | Retention |
|---|---|
| Event data - the eight events and their parameters | 2 months |
| User data - data tied to the install identifier | 14 months |

The file left behind locally, `~/.config/dira/analytics.json`, is on your own Mac and not on
the Company's side. Delete the file and it is gone that moment; the next run issues a new
install identifier.

## 6. Processors and transfers abroad

| Processor | Work | Country |
|---|---|---|
| Google LLC | Collecting and analyzing GA4 events | United States |
| Vercel Inc. | Website hosting and visit totals | United States |
| Channel Corporation | Answering questions through the support widget | - |

Channel Corporation is a Korean company, and the cloud Channel Talk runs on is the AWS Seoul
region. So nothing in this arrangement leaves the country. That company does hand part of its
own work abroad, though.
Sections 6 and 7 of the [Channel Talk privacy policy](https://channel.io/kr/privacy) carry
that list (checked 2026-08-04).

Beyond these three, the Company gives personal information to no third party.

## 7. Your rights

- **Turning it off** - the gear at the top right of the app › `Settings` dialog, third
  section. It starts on, and one button turns it off. From that moment nothing goes out.
- **Deleting** - delete `~/.config/dira/analytics.json` and the install identifier goes with
  it. You are counted again as a new install, unconnected to the earlier statistics.
- **Asking** - info@proofer.tech

## 8. Privacy officer

| Item | Detail |
|---|---|
| Name | Hansol Lim (임한솔), representative |
| Contact | info@proofer.tech |

## 9. Company information

| Item | Detail |
|---|---|
| Company | Proofer Inc. (프루퍼 주식회사) |
| Representative | Hansol Lim (임한솔) |
| Business registration number | 337-81-03650 |
| Address | 421A, 2F, 47 Gangnam-daero 112-gil, Gangnam-gu, Seoul, Korea |
| Contact | info@proofer.tech |

## 10. Effective date

This policy takes effect on 2026-08-04. This revision covers one axis, the support widget
attached to the website. What the app (`dira teams`) sends and does not send has not changed
by a line from the version before it, effective 2026-08-02.
