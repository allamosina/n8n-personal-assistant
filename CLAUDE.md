# CLAUDE.md

Personal assistant on self-hosted n8n. It reads Gmail, LinkedIn notification emails and
Telegram messages forwarded to a private bot, turns anything that needs attention into
tasks in Notion, prepares Gmail reply **drafts**, and sends a morning digest to Telegram
with a feasibility check against the calendar. The assistant prepares and suggests; the
owner decides and sends.

Read first: `PRD.md` (product), `docs/PLAN.md` (build order and phases),
`docs/PRD-REVIEW.md` (design decisions that deviate from or refine the PRD).

## Hard rules

1. **No send operation, ever.** No Gmail `send`/`reply`/`sendAndWait`, no `emailSend` node,
   no HTTP call to a send endpoint. Drafts only. `npm run check` enforces this and
   `npm run deploy` refuses to push when it fails.
2. **Telegram writes only to the owner's chat.** The chat ID always comes from config,
   never from an incoming message.
3. **Never change dates, priorities or statuses in Notion automatically**, except:
   creating items (WF0) and closing FYI items after a digest was delivered (WF3).
4. **No secrets or personal data in git.** Credentials live only in n8n. Ignore and
   exclusion lists, chat IDs, database IDs and the public hostname live in
   `config/config.local.json` and `infra/.env`, both gitignored. Exported workflow JSON is
   sanitized by `npm run export` before it lands in `workflows/`. The repo is meant to be
   shareable as a sample.
5. **The repo is the source of truth.** Prompts, Code-node logic and config are edited
   here and injected into workflow JSON by `npm run build`. Never edit them in the n8n UI;
   a build overwrites UI edits.
6. **Ask before destructive actions on live systems**: deleting or deactivating workflows
   on the server, changing the schema of a populated Notion database, restoring a backup.
7. **Privacy exclusion list runs before any model call**, Jev included. Notion stores a
   summary and a link, never a full message body.

## Repository layout

| Path | Purpose |
|---|---|
| `workflows/` | n8n workflow JSON, one file per workflow (`WF1-email-triage.json`), sanitized |
| `prompts/` | System/user prompts and JSON schemas, one markdown file per prompt |
| `src/` | Code-node logic as pure ES modules (prefilter, capacity, feasibility, digest format) |
| `tests/` | `node --test` unit tests for `src/` |
| `config/` | `config.example.json` (committed) and `config.local.json` (gitignored) |
| `notion/schema.json` | Property definitions for "Assistant Inbox" and "Daily digests" |
| `scripts/` | `build`, `deploy`, `export`, `check-no-send`, `notion-setup`, `compare-deciders` |
| `infra/` | `docker-compose.yml` (n8n + Caddy), `Caddyfile`, `install.sh`, `backup.sh`, `.env.example` |
| `docs/` | `PLAN.md`, `PRD-REVIEW.md`, `SETUP.md` (manual steps), `NOTES.md` (friction log) |

Tooling is Node.js 20+ with **no dependencies** (built-in `fetch`, `node --test`).

## Commands

```
npm test               # unit tests for src/
npm run build          # inject src/, prompts/, config into workflows/*.json
npm run check          # no-send and privacy checks over workflows/*.json
npm run deploy -- WF1  # build + check + push one workflow to n8n via the public API
npm run export         # pull workflows from n8n, sanitize, write to workflows/
npm run notion:setup   # create the Notion databases from notion/schema.json
```

Deploy needs `N8N_HOST` and `N8N_API_KEY` in the environment (see `.env.example`).

## Workflow conventions

- Names: `WF0 Upsert Item`, `WF1 Email Triage`, `WF2 Telegram Intake`,
  `WF3 Morning Planner`, `WF4 Error Handler`, `WF5 Decide`. Build order is
  WF4 → WF0 → WF5 → WF2 → WF1 → WF3 (simplest end-to-end path first).
- **Injection convention.** A node whose `notes` field contains `inject: src/<file>.js`
  gets its `jsCode` replaced by that file at build time; `inject: prompts/<name>.md`
  replaces the prompt field. The file is the source; the JSON is generated.
- Code nodes call a single exported pure function and return its result. Logic is
  testable without n8n. No `$env`, `$node` or network access inside `src/`; pass inputs in.
- Every workflow starts with a `Config` Code node (built from `config.local.json` plus
  `$env` secrets) so settings are in one place per workflow.
- Every Notion write goes through `WF0 Upsert Item` (idempotent on `Source ID`).
  Every classification goes through `WF5 Decide`. Every Claude call is an HTTP Request
  node (not the LangChain Anthropic node) so `output_config` is under our control.
- External-API nodes: "Retry on fail" on, 3 attempts, 2 s wait. `WF4` is the error
  workflow for every other workflow.
- Deterministic things (dedup, filtering, date math, capacity arithmetic, trimming the plan
  to fit) are code. Judgment (classification, summaries, drafts, prioritization) is a model.

## LLM rules

- Model IDs are config, never hard-coded in nodes:
  `claude-haiku-5-5` (triage, enrichment, drafts), `claude-sonnet-5-5` (planner);
  `claude-opus-5-5` is the planner upgrade if quality is not good enough.
- Endpoint `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`,
  `anthropic-version: 2023-06-01`, API key from the n8n credential.
- Always structured output:
  `output_config: { format: { type: "json_schema", schema: {...} } }` with
  `additionalProperties: false` and every field in `required`. The first `text` block is
  valid JSON. Keep the schema next to the prompt in `prompts/`.
- Thinking is adaptive by default on these models. Set `output_config.effort`:
  `low` for triage/enrichment, `medium` for drafts, `high` for the planner.
  `max_tokens` must leave room for thinking: 1024 triage, 2048 drafts, 8000 planner.
- Do **not** set `temperature`, `top_p`, `top_k` (400 on Haiku 5.5). No assistant prefill.
- Read response content by block `type`, never by index.
- Bound inputs: email bodies truncated to ~6k characters before the call; the planner
  sees at most 40 candidate tasks.
- Language: drafts in the language of the incoming message; task titles and digest in
  Russian unless config says otherwise.

## Jev (TypeSafe AI) rules

- `WF5 Decide` answers four typed questions: `action_needed` (noul), `action_type`
  (choice: `email_reply` / `other`), `priority` (choice P1–P3), `estimate` (choice
  15/30/60/120). Jev is called by HTTP Request (`POST /v1/systemone`, `model: jev-latest`);
  base URL is config so OpenRouter's `/api/v1/systemone` can stand in.
- `DECIDER_MODE` in config: `haiku` (Claude only, default on day one), `shadow` (call both,
  act on Haiku, store both), `jev` (Jev primary; fall back to Haiku on HTTP error, 10 s
  timeout, or `max(p, 1-p) < CONFIDENCE_THRESHOLD` for `action_needed`).
- Every item records `Decided by` and `Confidence`; in shadow mode also `Shadow decision`.
  Haiku's confidence is self-reported, not calibrated: never compare the two as equals.
- Jev never produces free text. Titles, summaries, due dates, drafts and plans are Claude.

## n8n Community Edition gotchas

- No Variables (`$vars`) in Community Edition. Use `$env` (requires
  `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`) plus the injected `Config` node.
- The Notion node has not reliably supported the `status` property type. `Status` is a
  `select` in `notion/schema.json`. If a Notion node cannot do something, use an HTTP
  Request node with the same Notion credential rather than fighting the node.
- Gmail "Create Draft": pass `threadId` and the exact `Re: <subject>`. Verify once that the
  draft threads correctly; if not, create the draft through the Gmail API with a raw MIME
  message carrying `In-Reply-To` and `References`.
- Telegram messages are limited to 4096 characters: `src/digest-format.js` splits by section.
- Gmail Trigger polls; its query must exclude `label:assistant/processed`, promotions,
  forums, spam and own sent mail. Notion `Source ID` is the real idempotency guard.
- Database is SQLite (n8n default). Keep `EXECUTIONS_DATA_PRUNE=true` and a short
  `EXECUTIONS_DATA_MAX_AGE` so it stays small. Backups are a tar of the n8n volume.

## Data model

`notion/schema.json` is authoritative. `Source ID` formats: Gmail `gmail:<messageId>`,
LinkedIn `linkedin:<gmail messageId>`, Telegram `tg:<chat_id>:<message_id>`, manual items
empty. Manual tasks need only a Title; defaults are P2 and 30 minutes.

## Cost guardrails

Target is under €15/month for hosting plus models; expected is €6–7. Rule pre-filter
before any model call, bounded inputs, one planner call per day, no polling faster than
30 minutes. If a change adds a model call per email, say so in the PR or commit message.

## Friction log

Whenever an n8n limitation forces a workaround, append a dated entry to `docs/NOTES.md`
(what was tried, what failed, what was done instead). This is a PRD success metric.

## Git

- Work on the assigned feature branch; commit small, descriptive, imperative messages.
- Never commit `config/config.local.json`, `infra/.env`, backups or unsanitized exports.
- Open a pull request only when asked.
