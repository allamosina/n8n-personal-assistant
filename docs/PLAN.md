# Development plan

Phased plan for building the assistant described in `PRD.md`, with the changes from
`docs/PRD-REVIEW.md`. Build order inside n8n follows the PRD: **WF4 → WF0 → WF5 → WF2 →
WF1 → WF3**, simplest end-to-end path first. Phases 0 and 1 run in parallel: Phase 0 needs
no server, Phase 1 is manual setup by the owner.

Legend: **[CC]** Claude Code does it, **[owner]** requires the owner (accounts, OAuth,
payments), **[both]** Claude Code prepares, owner confirms.

## Target architecture (after review)

```
Gmail Trigger ──► WF1 Email Triage ──┐
                                     ├──► WF5 Decide ──► WF0 Upsert Item ──► Notion "Assistant Inbox"
Telegram bot ──► WF2 Telegram Intake ┘   (Jev | Haiku,                               │
                                          mode switch)                                ▼
Schedule 07:30 ──► WF3 Morning Planner ◄── Google Calendar (today)            reads open items
                        │
                        └──► Telegram digest (split ≤4096) + Notion "Daily digests" page
Any failure ──► WF4 Error Handler ──► Telegram alert
```

Runtime: one VPS, Docker Compose with `n8n` (SQLite) and `caddy`. Repo tooling: Node.js
20+, no dependencies.

## Phase 0 — Repository foundation [CC] — done

Everything here runs locally with `node --test`; no server, no credentials.

1. **Scaffold.** `package.json` (scripts only, no dependencies), `.gitignore`,
   `.env.example` (`N8N_HOST`, `N8N_API_KEY`), `README.md`, CI workflow running tests and
   checks on every push and pull request.
2. **Notion schema.** `notion/schema.json` with both databases from PRD §8 plus
   `Decided by`, `Confidence`, `Shadow decision`. `Status` is a `select`.
3. **Config.** `config/config.example.json`: owner profile and tone, working hours, digest
   time and days, defaults, model IDs, decider mode and threshold, Jev endpoint, filter
   lists, languages.
4. **Pure logic in `src/`, tested in `tests/`:**
   - `prefilter.js` — exclusion list first, ignore list, LinkedIn routing, job-alert drop,
     body trimming.
   - `parse-forward.js` — owner guard, `forward_origin` variants, exclusion by origin;
     kinds `forward`, `note` (own text) and `reply` (to a bot confirmation).
   - `normalize-item.js` — the WF0 item contract, Notion property mapping both ways,
     update payload that never touches owner-controlled fields.
   - `capacity.js` — free minutes and slots in Europe/Prague; skips declined, cancelled
     and "free" events; all-day busy events block the day; 10-minute buffer.
   - `candidates.js` — open tasks ranked overdue → due ≤ 3 days → priority → due → age,
     capped at 40; FYI and drafts-waiting lists.
   - `feasibility.js` — validates the planner's IDs and trims `today` to free minutes.
   - `digest-format.js` — one section model, Telegram HTML chunks ≤ 4096, Notion blocks.
   - `decide-merge.js` — Jev request, tolerant Jev parsing, `DECIDER_MODE`, fallback,
     shadow record, Gmail-only `email_reply` rule.
   - `claude.js` — request body with structured output and effort; response parsing by
     block type with refusal and truncation errors.
5. **Prompts in `prompts/`:** `decide.md` (with per-channel guidance), `enrich.md`,
   `draft-reply.md`, `planner.md`. Format in `prompts/README.md`; schemas are strict.
6. **Scripts in `scripts/`:** `build.mjs` (marker injection into `build/`),
   `check-no-send.mjs`, `deploy.mjs` (dry run, name-based sub-workflow references, WF4 as
   error workflow, credentials kept across redeploys), `export.mjs` (sanitize and empty
   inject blocks). Notion setup and the Jev-vs-Haiku comparison use the Notion connector.
7. **Infra in `infra/`:** compose with pinned n8n 2.42.6 (SQLite, pruning, env access
   blocked) and Caddy 2.11.7; `install.sh`; `backup.sh` (stops n8n for a consistent
   SQLite copy, rclone to an encrypted remote); `restore.sh` (verify or apply).
8. **Docs:** `docs/SETUP.md` (owner checklist) and `docs/NOTES.md` (friction log).

Exit criteria: `npm test` green; `npm run check` green on the (still empty) workflows set;
`npm run build` succeeds; CI green.

## Phase 1 — Manual setup [owner]

Checklist in `docs/SETUP.md`:

1. VPS (Hetzner CX22 class, Debian 12) and an `A` record for the subdomain.
2. Telegram bot via BotFather; own chat ID (send `/start`, read `getUpdates`).
3. Notion internal integration for n8n (its token becomes an n8n credential); pick a parent
   page for the databases.
4. Google Cloud project with OAuth client (Gmail read, modify labels, drafts; Calendar
   read-only); add own account as test user.
5. Anthropic API key. Jev API key (TypeSafe early access) or OpenRouter key.
6. For Claude Code cloud sessions: add `N8N_HOST` and `N8N_API_KEY` as environment
   variables and the n8n host to the environment's allowed domains.
7. Gmail labels `assistant/processed` and `assistant/fyi`.
8. Choose backup target (Google Drive folder via rclone, or an S3-compatible bucket).

## Phase 2 — Server [both]

1. [CC] Run `install.sh` over SSH, copy `infra/`, fill `.env` (generate
   `N8N_ENCRYPTION_KEY`), `docker compose up -d`, confirm HTTPS and `/healthz`.
   This needs SSH access from the session; otherwise the owner runs the same commands
   from `docs/SETUP.md`.
2. [owner] Create the n8n owner account in the browser; create an API key; put it in the
   local `.env` for the deploy script.
3. [CC] Install the `backup.sh` cron (nightly 03:00 Europe/Prague), run one backup and
   verify it with `restore.sh <archive>` (verify mode).

Exit criteria: `https://<host>/healthz` returns OK; a dated backup exists in the remote
target; the restore test listed the SQLite file and `.env`.

## Phase 3 — Notion [CC]

Claude Code creates "Assistant Inbox" and "Daily digests" from `notion/schema.json` through
the Notion MCP connector, under a parent page the owner names, and writes the IDs to
`config.local.json`. The owner then shares that parent page with the n8n Notion integration. Add two manual tasks by hand (one with a due date,
one with only a title) to exercise defaults later.

## Phase 4 — Workflows, one at a time [both]

Each step: write the JSON in `workflows/`, `npm run deploy -- WFx`, run it with sample
data, fix, then move on. The owner connects OAuth credentials in the n8n UI the first
time a workflow needs them (Gmail, Calendar, Notion, Telegram, Anthropic, Jev as a
generic header credential).

1. **WF4 Error Handler.** Error Trigger → format → Telegram. Test by deploying a
   throwaway workflow with a failing node and WF4 set as its error workflow.
2. **WF0 Upsert Item.** Execute Workflow Trigger → Notion query by `Source ID` → IF →
   create or update → return page URL. Test: run twice with the same input, one row.
3. **WF5 Decide.** Config → Switch on `DECIDER_MODE` → Jev HTTP Request (timeout 10 s,
   continue on fail) and/or Haiku HTTP Request (structured output) → `decide-merge.js` →
   output decision plus `decided_by`, `confidence`, `shadow`. Build in `haiku` mode
   first, add the Jev branch, then test `shadow` and `jev` with a fixture email.
4. **WF2 Telegram Intake.** Telegram Trigger → chat-ID guard → `parse-forward.js` →
   WF5 (priority and estimate only) → Haiku enrich → `normalize-item.js` → WF0 → bot
   confirmation with the Notion link. First real end-to-end path; forward three
   messages (plain, forwarded from a user, forwarded from a channel).
5. **WF1 Email Triage.** Gmail Trigger (30 min, filtered query) → `prefilter.js` → Switch
   (drop / linkedin / email) → WF5 → Switch on decision → FYI path (no further model
   call, label `assistant/fyi`) or enrich → draft (Reply kind only) → WF0 → label
   `assistant/processed`. Test with five seeded emails including one excluded sender
   (must never reach WF5, assert in the execution log) and one LinkedIn InMail.
6. **WF3 Morning Planner.** Schedule (07:30, weekdays per config) → Notion open items and
   FYI since last digest → Calendar today → `capacity.js` → `candidates.js` → Sonnet
   planner (structured) → `feasibility.js` → Notion digest page → `digest-format.js` →
   Telegram (chunked) → close FYI items. Test with a fabricated overloaded day and assert
   the code trimmed the plan; test an empty day; test a day with a long digest.

Exit criteria: all six active on the server; the no-send check passes on the exported
JSON; the friction log has entries for anything that needed a workaround.

## Phase 5 — Dry week [both]

1. `DECIDER_MODE = shadow`. The assistant runs; the owner keeps planning by hand and
   compares the digest every morning.
2. Grow the ignore and exclusion lists from the FYI noise; redeploy config.
3. End of week: Claude Code queries "Assistant Inbox" through the Notion connector and reports
   Jev-vs-Haiku agreement and the confidence spread → decide
   `DECIDER_MODE` and the threshold.
4. Review drafts: are they short, in the right language, with clear `[[placeholders]]`? If
   not, switch the draft model to Sonnet 5.5 in config.

Exit criteria: zero missed replies or deadlines in the week; a written decision on the
decider mode; lists populated.

## Phase 6 — Export and shareable sample [CC]

`npm run export` → review the diff for any personal data → README with the architecture
diagram, the mode switch, cost figures from the first month and how to run it yourself.

## Backlog (not v1)

- `/digest` and `/today` bot commands.
- Reply-to-confirmation comments that update an item.
- Opus 5.5 for the planner if Sonnet's plans are weak.
- Weekly review digest; learning from edited drafts.
- Calendar event creation after confirmation; Telegram Business; WhatsApp; job-scanner
  import.

## Risks and how the plan handles them

| Risk | Handling |
|---|---|
| Jev access or API shape differs from third-party docs | `haiku` mode is the default; Jev is an isolated HTTP node with a base URL in config; OpenRouter route as a stand-in |
| Notion node cannot write `select`/filters as expected | HTTP Request node with the same credential; schema keeps `Status` as `select` |
| Gmail draft does not thread for the recipient | Verify once in Phase 4 step 5; raw MIME fallback via Gmail API |
| Too much FYI noise in the first digests | Lists grow during the dry week; FYI never triggers model calls, so cost is unaffected |
| Workflow JSON drifts from the repo after UI edits | Build overwrites injected fields; `CLAUDE.md` rule: never edit prompts or code in the UI |
| VPS loss | Nightly volume backup with a tested restore; encryption key in the backup |
