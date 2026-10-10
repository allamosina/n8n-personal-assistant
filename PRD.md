# PRD: Personal Assistant on n8n

**Owner:** Alla Mosina
**Status:** Draft v0.3, October 2026
**Timezone for all schedules:** Europe/Prague

---

## 1. Summary

A personal assistant built on n8n that reads incoming email, LinkedIn notifications and Telegram messages I forward to a bot, turns everything that needs my attention into tasks in Notion, prepares reply drafts in Gmail, and every morning sends me a prioritized plan for the day that takes my calendar into account and tells me honestly whether the plan fits into the time I have.

The assistant never sends anything on my behalf. It prepares, sorts and suggests, and I make the decisions.

## 2. Problem

My incoming requests are spread across Gmail, LinkedIn and Telegram, and my tasks live partly in Notion and partly in my head. During an active job search the volume is high and the cost of missing something (a recruiter reply, a take-home deadline, an interview invite) is real. Each morning I spend time reconstructing what needs to happen today, and I regularly plan more than fits into the day.

## 3. Goals

1. Nothing that needs an action or a reply gets lost, whichever channel it came from.
2. Replies that I need to write are already waiting for me as Gmail drafts.
3. All tasks live in one Notion database, together with the ones I add by hand.
4. Every morning I get one digest with today's priorities, my meetings, and a short list of informational emails.
5. The digest checks feasibility: it compares the planned work with my free time and suggests what to move.
6. Running cost stays low (target: under €15 per month for hosting and LLM together).

## 4. Non-goals (v1)

- Sending emails or messages automatically. There is no send operation anywhere in the system.
- Reading my Telegram chats directly. In v1 I forward relevant messages to the bot myself (see 12, Future).
- Changing dates or priorities in Notion automatically. The assistant only suggests; I edit Notion myself.
- Creating calendar events.
- Job search scanning. This is handled by my existing local job scanner.

## 5. Principles

- **Human in the loop.** The assistant drafts and suggests. Anything that leaves my accounts or changes my plan is done by me.
- **Code for facts, LLM for judgment.** Deduplication, filtering, time calculations and date math are deterministic code. The LLM is used for classification, summarization, drafting and prioritization.
- **Cheap by default.** Rule-based pre-filters run before any LLM call. A small model handles high-volume triage; a stronger model runs once a day for planning.
- **Idempotent.** Every item has a stable source ID, so re-running a workflow never creates duplicate tasks or drafts.
- **Privacy-aware.** Other people's messages go to an LLM, so there is an exclusion list of senders and chats, and Notion stores a summary and a link instead of full message bodies.

## 6. Sources and inputs

| Source | How it is read | Notes |
|---|---|---|
| Gmail | Gmail Trigger (polling every 30 minutes) | Pre-filtered by Gmail query and sender rules before the LLM |
| LinkedIn | Notification emails in Gmail from linkedin.com | Separate branch with its own prompt; LinkedIn has no messaging API |
| Telegram | Messages I forward to my private bot | Bot accepts messages only from my own chat ID |
| Notion | Tasks database, including tasks I add manually | Single source of truth for tasks |
| Google Calendar | Read-only, today's events | Used by the morning planner |

## 7. Architecture

Six workflows. Shared logic lives in two sub-workflows: `WF5 Decide` makes the classification decision (Jev with fallback to Haiku, see section 9), and `WF0 Upsert Item` writes to Notion, so every source is classified and stored the same way.

```
 Gmail Trigger ──► WF1 Email Triage ──┐   WF5 Decide (Jev → Haiku fallback)
                                      ├──► WF0 Upsert Item (sub-workflow) ──► Notion "Assistant Inbox"
 Telegram bot ──► WF2 Telegram Intake ┘                                              │
                                                                                     ▼
 Schedule 07:30 ──► WF3 Morning Planner ◄── Google Calendar (today)          reads open items
                          │
                          └──► Telegram message (digest) + Notion page "Daily digest"

 Any failure ──► WF4 Error Handler ──► Telegram alert
```

### WF0. Upsert Item (sub-workflow)

Input: normalized item `{source, source_id, kind (Action / Reply / FYI), title, summary, link, due, priority, estimate_min, sender}`.

1. Query Notion for an existing row with the same `Source ID`.
2. If it exists, stop (or update the summary if the thread has new messages).
3. If it does not exist, create a row.
4. Return the Notion page URL to the caller.

### WF1. Email Triage (Gmail + LinkedIn)

1. **Trigger.** Gmail Trigger, every 30 minutes, query excludes `category:promotions`, `category:forums`, spam, and my own sent mail.
2. **Rule pre-filter (Code node, no LLM).**
   - Drop senders and domains from the ignore list (newsletters, receipts, services I never act on).
   - Drop senders from the privacy exclusion list entirely.
   - Route `@linkedin.com` senders to the LinkedIn branch.
   - Drop LinkedIn job alert emails (my job scanner covers them).
3. **Decision (Jev, typed output with confidence).** Two questions per email:
   - `action_needed`: yes / no. Does this email require anything from me?
   - `action_type` (only if yes): `email_reply` (the action is to answer this email) / `other` (anything else: prepare something, book, pay, reply on another channel)

   If `action_needed = yes`, Jev also returns `priority` (P1, P2, P3) and `estimate_bucket` (15, 30, 60 or 120 minutes). Each answer comes with a confidence score. If confidence for `action_needed` is below the threshold (default 0.7), or Jev is unavailable, the email falls back to the small LLM with the same output schema.
4. **Routing (Switch).**
   - `action_needed = no` → no LLM call. The email is saved as an FYI item using its subject and sender as they are, and appears in the next digest as one line with a link. Gmail label `assistant/fyi`.
   - `action_needed = yes`, `action_type = other` → enrichment (step 5), then upsert an item with `Kind = Action`.
   - `action_needed = yes`, `action_type = email_reply` → enrichment (step 5), draft (step 6), then upsert an item with `Kind = Reply`.
5. **Enrichment (small LLM, only for emails that need action).** Returns the text fields Jev cannot generate: `title` (short imperative task title), `summary` (1–2 sentences), `due` (date if stated or clearly implied, otherwise null), `priority_reason` (one line). Emails without action never reach this step, which is where most of the savings come from.
6. **Draft.** The LLM writes a reply in the language of the incoming email, in my tone, short and specific. The Gmail node creates a **draft** in the same thread. The Notion item gets `Draft created = true` and a link to the thread. If the email needs information the assistant does not have, the draft contains clearly marked placeholders like `[[date?]]`.
7. **Labeling.** Every processed email gets the Gmail label `assistant/processed`, so I can see in Gmail what the assistant has handled.

**LinkedIn branch.** Same two questions, with a prompt tuned for LinkedIn notification emails. An InMail or recruiter message that needs an answer is always `action_type = other`, because the reply has to happen inside LinkedIn and cannot be drafted in Gmail; the task is titled "Reply on LinkedIn: …" with a link to the conversation. Connection requests and post notifications are usually `action_needed = no` and go to the FYI list.

### WF2. Telegram Intake

1. **Trigger.** Telegram Trigger on messages to my bot.
2. **Guard.** If the sender's chat ID is not mine, stop.
3. **Parse.** Extract text, the original sender and date from `forward_origin`, and an optional comment if I add one in the same message or the next one.
4. **Classify.** Since I forwarded the message on purpose, `action_needed` is always yes and Jev decides only `priority` and `estimate_bucket`; the small LLM writes the title and summary. Same fallback rule as in WF1. If the action is to answer the message, the task is titled "Reply in Telegram to …" and no draft is created (optional later: put a suggested reply text into the Notion item).
5. **Upsert** via WF0.
6. **Confirm.** The bot answers with one line: "Added: <title> (P2, due Mon)" and a link to the Notion item.
7. **Commands (nice to have).** `/digest` runs WF3 on demand; `/today` shows open P1 items.

### WF3. Morning Planner and Digest

Runs every day at 07:30 (configurable; weekdays only by default).

1. **Collect.**
   - Open items from Notion (`Status` is Inbox, Planned or In progress), including ones I added manually.
   - FYI items created since the last digest.
   - Today's events from Google Calendar.
2. **Compute capacity (Code node, no LLM).**
   - Working window from config (default 09:00–18:00).
   - Subtract meeting time plus a 10-minute buffer per meeting.
   - Free minutes = what is left; also list the free slots.
   - Planned load = sum of `Estimate (min)` of candidate tasks; missing estimates default to 30 minutes.
3. **Prioritize (stronger LLM, one call per day).** Input: tasks with priority, due date, age and estimates; free slots; meetings. Output:
   - `today`: ordered list of tasks that fit, each with a suggested slot
   - `move`: tasks that do not fit, each with a reason and a suggested new date
   - `risks`: deadlines in the next 3 days that are at risk
   - `note`: one sentence on how the day looks overall
4. **Feasibility check (Code node).** Verify that the sum of estimates in `today` does not exceed free minutes. If it does, move the lowest-priority items into `move` before sending. The LLM proposes; the code guarantees the arithmetic.
5. **Deliver.**
   - Telegram message with sections: Meetings, Top priorities, Suggested to move, At-risk deadlines, FYI (one line per email with a link), Drafts waiting in Gmail.
   - The same content saved as a page in the Notion "Daily digests" database for history.
6. **Close FYI items** that were included in the digest (`Status = Done`).

The planner never changes dates in Notion. I review the "Suggested to move" list and edit Notion myself.

### WF4. Error Handler

Error workflow attached to WF0–WF3. Sends a Telegram message with the workflow name, failed node, error text and a link to the execution. Nodes that call external APIs use retries (3 attempts with backoff).

## 8. Data model

### Notion database "Assistant Inbox"

| Property | Type | Values / notes |
|---|---|---|
| Title | title | Imperative task title |
| Kind | select | Action, Reply, FYI |
| Status | status | Inbox, Planned, In progress, Done, Dropped |
| Source | select | Gmail, LinkedIn, Telegram, Manual |
| Source ID | rich text | Gmail message ID, Telegram `chat_id:message_id`; empty for manual items |
| Link | URL | Gmail thread, LinkedIn conversation or Telegram message |
| Summary | rich text | 1–2 sentences from the LLM |
| Sender | rich text | Name and address or handle |
| Due | date | Optional |
| Priority | select | P1, P2, P3 |
| Priority reason | rich text | One line from the LLM |
| Estimate (min) | number | LLM guess, I can overwrite |
| Draft created | checkbox | True when a Gmail draft exists |
| Created by | select | Assistant, Me |

Manual tasks I add need only Title; the planner treats missing fields with defaults (P2, 30 minutes).

### Notion database "Daily digests"

Date, Free minutes, Planned minutes, Overloaded (checkbox), and the digest as page content.

### Config (n8n variables or a Notion "Assistant settings" page)

Working hours, digest time, ignore list, privacy exclusion list, my Telegram chat ID, default estimate, model names.

## 9. LLM usage

Three tiers, each used for what it does best.

| Task | Volume | Model |
|---|---|---|
| Decisions: action needed (yes/no), action type (email reply / other), priority, effort bucket | Every email and message that passes the rule filter | **Jev** (TypeSafe AI). Typed outputs with calibrated confidence, 70–500 ms, $0.042 per million input tokens, output free |
| Text fields: title, summary, due date, priority reason; fallback decisions | Only items that need action, plus low-confidence cases | **Claude Haiku 4.5** |
| Reply drafts | A few per day | Claude Haiku 4.5 by default; switch to Sonnet if draft quality is not good enough |
| Morning planning | 1 per day | **Claude Sonnet** |

Why this split: Jev is built for classification and routing with a fixed set of possible answers, and it reports how confident it is, which gives a natural rule for when to escalate to an LLM. It cannot generate free text, so titles, summaries, drafts and the plan stay with Claude.

Jev is in early access and its API is not a standard LLM API, so it is called through an HTTP Request node wrapped in its own sub-workflow (`WF5 Decide`). If Jev fails or times out, `WF5` falls back to Haiku with the same output schema, and the rest of the system does not notice the difference. Every decision is logged with the model used and its confidence, which lets me compare Jev and Haiku on my real data after a few weeks.

All Claude calls use structured output with a JSON schema. Model names are configuration, so any of them can be swapped.

## 10. Non-functional requirements

- **Cost.** Under €15 per month in total; LLM spend is expected to be a few euros per month thanks to pre-filtering.
- **Latency.** Email items appear in Notion within 30 minutes; Telegram items within a few seconds.
- **Safety.** No Gmail send operation exists in any workflow. The repository includes a check script that fails if a send operation appears in any exported workflow JSON.
- **Privacy.** Excluded senders and chats are never sent to an LLM. Notion stores summaries and links, not full bodies. Credentials live only in n8n and are never committed to the repository.
- **Reliability.** Idempotent writes by Source ID, retries on external calls, error alerts in Telegram.
- **Languages.** Emails and messages arrive in Russian, English and Czech; drafts are written in the language of the incoming message; the digest is in Russian (configurable).

## 11. Hosting

**Decision:** self-hosted n8n Community Edition on a small VPS, around €5 per month. It has no execution limits, and the Telegram trigger needs a public HTTPS URL, which rules out running it on my laptop.

Setup: Docker Compose with n8n, Postgres and Caddy (automatic HTTPS) on a subdomain I own. Requirements:
- Basic auth disabled in favor of n8n's own user management; only port 443 open, SSH by key only.
- Nightly backup of the Postgres database and the n8n encryption key to external storage.
- `GENERIC_TIMEZONE=Europe/Prague`, `WEBHOOK_URL` set to the public URL, n8n public API enabled for Claude Code.
- Image version pinned; upgrades done deliberately, not automatically.

## 12. Future

- Read Telegram directly through Telegram Business (requires Premium) or a userbot.
- WhatsApp.
- Create calendar events for interview invites after confirmation.
- Pull results from my job scanner into the same Notion database.
- Weekly review: what got done, what keeps getting moved.
- Learning from my edits: compare drafts with what I actually sent and adjust the prompt.

## 13. Success metrics

- Share of incoming emails handled without me opening them (filtered out by rules or listed as FYI).
- Share of drafts I send with only minor edits.
- Number of overloaded days caught by the planner, and how often I accept its suggestions.
- Missed replies or deadlines per month (target: zero).
- A running log of friction I hit while building in n8n, kept in the repository as product notes.

## 14. Open questions

1. Jev early access: confirm I have API access, and check its docs for the request format, input limits and support for Russian and Czech.
2. Confidence threshold for falling back from Jev to Haiku (start at 0.7, tune after a week).
3. Working hours and whether the digest runs on weekends.
4. Initial ignore list and privacy exclusion list.
5. Whether to start with a new Notion database or connect an existing one.
6. VPS provider and the subdomain for n8n.

## 15. Implementation plan (for Claude Code)

1. **Repository.** Create the repo with this PRD, a `CLAUDE.md`, `workflows/` (exported JSON), `prompts/`, `notion/schema.json`, `scripts/` (including the no-send check) and `.env.example`.
2. **Manual setup (me).** Rent the VPS and point a subdomain to it; create the Telegram bot in BotFather; create a Notion integration and share the parent page with it; create Google OAuth credentials; get Anthropic and Jev API keys.
3. **Server.** Claude Code deploys n8n over SSH (Docker Compose, Postgres, Caddy, backups), then I create the owner account and an n8n API key.
4. **Notion.** Claude Code creates the "Assistant Inbox" and "Daily digests" databases from `notion/schema.json`.
5. **n8n.** Claude Code builds the workflows through the n8n API or an n8n MCP server, in this order: WF4, WF0, WF5, WF2 (simplest end-to-end check), WF1, WF3.
6. **Credentials.** I connect Gmail, Calendar, Notion, Telegram and Anthropic credentials in the n8n UI (OAuth needs a browser sign-in).
7. **Test.** Run each workflow with sample data, then a dry week where I compare the digest with my own plan.
8. **Export.** Export workflows to the repository, strip personal data, and prepare the sample for the application.
