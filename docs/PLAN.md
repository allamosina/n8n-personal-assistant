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

## Phase 0 — Repository foundation [CC]

Everything here runs locally with `node --test`; no server, no credentials.

1. **Scaffold.** `package.json` (`"type": "module"`, scripts only), `.gitignore`
   (`config/config.local.json`, `infra/.env`, `*.bak`, `exports/`), `.env.example`
   (`N8N_HOST`, `N8N_API_KEY`, `NOTION_TOKEN`), `README.md` (what it is, how to run the
   scripts), directories `workflows/ prompts/ src/ tests/ config/ notion/ scripts/ infra/ docs/`.
2. **Notion schema.** `notion/schema.json` with both databases from PRD §8 plus
   `Decided by` (select), `Confidence` (number), `Shadow decision` (rich text).
   `Status` is a `select` (Inbox, Planned, In progress, Done, Dropped).
3. **Config.** `config/config.example.json`: working hours, digest time and days, default
   estimate, model IDs, `DECIDER_MODE`, `CONFIDENCE_THRESHOLD`, Jev base URL, empty
   `ignore_senders`, `ignore_domains`, `exclude_senders`, `exclude_chats`, digest language.
4. **Pure logic in `src/` with tests in `tests/`:**
   - `prefilter.js` — ignore list, exclusion list (hard drop), LinkedIn routing, LinkedIn
     job-alert drop. Returns `{ action: "drop" | "linkedin" | "email", reason }`.
   - `parse-forward.js` — Telegram `forward_origin` variants (user, hidden user, chat,
     channel) → `{ text, original_sender, original_date, comment }`.
   - `normalize-item.js` — builds the WF0 input from any source; Source ID formats.
   - `capacity.js` — working window minus meetings minus 10 min per meeting → free minutes
     and free slots; handles all-day and overlapping events.
   - `candidates.js` — sorts and caps open items (overdue, P1, due ≤ 3 days, age), max 40.
   - `feasibility.js` — trims the planner's `today` list to free minutes, lowest priority
     first, moving trimmed items to `move` with a reason.
   - `digest-format.js` — renders sections and splits at 4096 characters.
   - `decide-merge.js` — applies `DECIDER_MODE`, the fallback rule and the shadow record.
5. **Prompts and schemas in `prompts/`:** `email-triage.md` (Jev question instructions
   and the matching Haiku JSON schema), `linkedin-triage.md`, `telegram-intake.md`,
   `enrich.md`, `draft-reply.md`, `planner.md`. Each file holds the system prompt, the user
   template with placeholders, and the JSON schema.
6. **Scripts in `scripts/`:**
   - `build.mjs` — for each `workflows/*.json`, replace `jsCode` or prompt fields on nodes
     whose `notes` say `inject: <path>`; fill the `Config` node from `config.local.json`.
   - `check-no-send.mjs` — the rules in `CLAUDE.md`; exit 1 on any hit.
   - `deploy.mjs` — build, check, then create or update and activate one workflow through
     the n8n public API (`/api/v1/workflows`). Matches by workflow name.
   - `export.mjs` — pull workflows, strip credential IDs, emails, chat IDs, webhook IDs,
     execution data; write to `workflows/`.
   - `notion-setup.mjs` — create the two databases under a parent page; write IDs to
     `config.local.json`.
   - `compare-deciders.mjs` — read "Assistant Inbox", print Jev vs Haiku agreement and
     confidence histogram (used in Phase 5).
7. **Infra in `infra/`:** `docker-compose.yml` (n8n pinned tag, SQLite volume, pruning
   env, Caddy), `Caddyfile` (reverse proxy on the subdomain, automatic HTTPS),
   `install.sh` (Docker from the official repo, UFW 22/443, compose up), `backup.sh`
   (tar of the n8n volume + `.env`, `rclone copy`, keep 14 days), `.env.example`.
8. **`docs/SETUP.md`** — the owner's checklist for Phase 1, and **`docs/NOTES.md`** —
   empty friction log with the entry format.

Exit criteria: `npm test` green; `npm run check` green on the (still empty) workflows set;
`npm run build` is a no-op without errors.

## Phase 1 — Manual setup [owner]

Checklist in `docs/SETUP.md`:

1. VPS (Hetzner CX22 class, Debian 12) and an `A` record for the subdomain.
2. Telegram bot via BotFather; own chat ID (send `/start`, read `getUpdates`).
3. Notion internal integration; share one parent page with it; note the page ID.
4. Google Cloud project with OAuth client (Gmail read, modify labels, drafts; Calendar
   read-only); add own account as test user.
5. Anthropic API key. Jev API key (TypeSafe early access) or OpenRouter key.
6. Gmail labels `assistant/processed` and `assistant/fyi`.
7. Choose backup target (Google Drive folder via rclone, or an S3-compatible bucket).

## Phase 2 — Server [both]

1. [CC] Run `install.sh` over SSH, copy `infra/`, fill `.env` (generate
   `N8N_ENCRYPTION_KEY`), `docker compose up -d`, confirm HTTPS and `/healthz`.
2. [owner] Create the n8n owner account in the browser; create an API key; put it in the
   local `.env` for the deploy script.
3. [CC] Install the `backup.sh` cron (nightly 03:00 Europe/Prague) and run one backup and
   one restore into a scratch directory.

Exit criteria: `https://<host>/healthz` returns OK; a dated backup exists in the remote
target; the restore test listed the SQLite file and `.env`.

## Phase 3 — Notion [CC]

`npm run notion:setup` creates "Assistant Inbox" and "Daily digests" from the schema and
writes the IDs to `config.local.json`. Add two manual tasks by hand (one with a due date,
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
3. End of week: `npm run compare-deciders` → agreement rate and confidence spread → decide
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
