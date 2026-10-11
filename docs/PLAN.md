# Development plan

Phased plan for building the assistant described in `PRD.md`, with the changes from
`docs/PRD-REVIEW.md`. Build order inside n8n follows the PRD: **WF4 → WF2 → WF1 → WF3**,
simplest end-to-end path first; the shared steps WF0 (upsert) and WF5 (decide) are built
once and reused inside the callers (see Phase 4). Phase 0 is done; Phase 1 is the owner's
manual setup.

**Hosting decision, 2026-10-10:** the project runs on the owner's existing **n8n Cloud**
Starter subscription, reached from Claude Code through the n8n connector. The self-hosting
setup in `infra/` stays in the repo as the alternative described in the PRD but is not used.

Legend: **[CC]** Claude Code does it, **[owner]** requires the owner (accounts, OAuth,
payments), **[both]** Claude Code prepares, owner confirms.

## Target architecture (after review)

```
Gmail Trigger ──► WF1 Email Triage ──┐  each: Decide (Jev | Haiku) ──► Upsert ──► Notion "Assistant Inbox"
Telegram bot ──► WF2 Telegram Intake ┘                                                      │
                                                                                            ▼
Schedule 07:30 ──► WF3 Morning Planner ◄── Google Calendar (today)                  reads open items
                        │
                        └──► Telegram digest (split ≤4096) + Notion "Daily digests" page
Any failure ──► WF4 Error Handler ──► Telegram alert
```

Runtime: n8n Cloud (Starter: 2 500 executions per month, no active-workflow cap). Repo
tooling: Node.js 20+, no dependencies.

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
   blocked) and Caddy 2.11.7; `install.sh`; `backup.sh`; `restore.sh`. Kept as the
   self-hosting alternative; unused on n8n Cloud.
8. **Docs:** `docs/SETUP.md` (owner checklist) and `docs/NOTES.md` (friction log).

Exit criteria (met): `npm test` green; `npm run check` green on the (still empty)
workflows set; `npm run build` succeeds; CI green.

## Phase 1 — Manual setup [owner] — in progress

Live checklist with status in `docs/SETUP.md`. Done: n8n Cloud with the n8n connector,
Gmail, Telegram and OpenRouter credentials in n8n, Notion connector in Claude. Left: the
owner's Telegram chat ID, a Notion parent page and integration token, a Google Calendar
credential, the two Gmail labels. Model keys are decided in Phase 4 (n8n Cloud offers
Anthropic and TypeSafe AI through its gateway credits).

## Phase 2 — n8n instance [CC] — done

n8n Cloud replaces the server. Claude Code reaches the instance through the n8n connector:
it can list credentials by name, create and update workflows, validate them, run tests and
publish. The seven pre-existing test workflows ("My workflow …", "Gmail app") are left
untouched.

## Phase 3 — Notion [CC] — done 2026-10-10

Claude Code creates "Assistant Inbox" and "Daily digests" from `notion/schema.json` through
the Notion MCP connector, under a parent page the owner names, and writes the IDs to
`config.local.json`. The owner then shares that parent page with the n8n Notion integration. Add two manual tasks by hand (one with a due date,
one with only a title) to exercise defaults later.

## Phase 4 — Workflows, one at a time [both]

**How workflows are built on n8n Cloud.** Claude Code creates and updates them through the
n8n connector (Workflow SDK code), validates and test-runs them there, and publishes. The
first step of the phase is reading the connector's SDK reference and best-practice notes and
deciding how `src/` logic and `prompts/` are injected into Code nodes in that flow; the
JSON toolchain (`npm run build`, `deploy`, `export`, `check`) stays as the fallback and as
the hygiene gate on exported JSON. The owner connects any missing credentials in the n8n UI
when a workflow first needs them.

**Execution budget.** n8n Cloud Starter allows 2 500 executions per month, and every
sub-workflow call counts as one. With two sub-workflows per email the quota would be gone
in two weeks, so WF0 Upsert and WF5 Decide are built once as node groups and reused inside
WF1 and WF2 rather than as separate workflows; their logic stays in `src/` and is injected
in both places. Expected use: at most 48 Gmail polls per day (a poll with no new mail is
not an execution), a few Telegram messages per day, one digest per day, about 1 600 per
month at the ceiling.

**Status 2026-10-10.** The order was changed because the Telegram bot token was not in n8n
yet: WF1 was built first (23 nodes, Haiku-only Decide, unpublished, exported to
`workflows/WF1-email-triage.json`). It waits for the "Anthropic" and "Notion" credentials
for its test run. **2026-10-11:** the chat ID is known and WF4 Error Handler is built,
published and set as WF1's error workflow (`workflows/WF4-error-handler.json`). WF2 is next;
WF3 waits for the Google Calendar credential.

1. **WF4 Error Handler.** Error Trigger → format → Telegram. Test by pointing a throwaway
   workflow with a failing node at it.
2. **WF2 Telegram Intake.** Telegram Trigger → chat-ID guard → `parse-forward.js` →
   Decide (priority and estimate only) → Haiku enrich → `normalize-item.js` → Upsert →
   bot confirmation with the Notion link. First real end-to-end path; forward three
   messages (plain, forwarded from a user, forwarded from a channel). This is where the
   Decide and Upsert node groups are built and tested: Decide in `haiku` mode first, then
   the Jev branch, then `shadow` and `jev` with a fixture message; Upsert run twice with
   the same input, one Notion row.
3. **WF1 Email Triage.** Gmail Trigger (30 min, filtered query) → `prefilter.js` → Switch
   (drop / linkedin / email) → Decide → Switch on decision → FYI path (no further model
   call, label `assistant/fyi`) or enrich → draft (Reply kind only) → Upsert → label
   `assistant/processed`. Test with five seeded emails including one excluded sender
   (must never reach a model, assert in the execution log) and one LinkedIn InMail.
4. **WF3 Morning Planner.** Schedule (07:30, weekdays per config) → Notion open items and
   FYI since last digest → Calendar today → `capacity.js` → `candidates.js` → Sonnet
   planner (structured) → `feasibility.js` → Notion digest page → `digest-format.js` →
   Telegram (chunked) → close FYI items. Test with a fabricated overloaded day and assert
   the code trimmed the plan; test an empty day; test a day with a long digest.

Exit criteria: WF1, WF2 and WF3 published, WF4 set as their error workflow; the no-send
check passes on the exported JSON; the friction log has entries for anything that needed a
workaround.

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
| Monthly execution quota runs out (workflows pause) | No sub-workflows; polling every 30 min; check usage in the n8n Cloud dashboard during the dry week |
| Connector cannot do something (publish, settings, credentials) | Fallback is the public API with `N8N_HOST` / `N8N_API_KEY` in the environment settings |
