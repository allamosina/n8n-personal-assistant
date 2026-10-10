# PRD review — v0.3, October 2026

Review of `PRD.md` with a focus on simplicity, running cost and effectiveness. Findings are
ranked by impact. Each one ends with a proposed change for PRD v0.4. Facts marked
**verify at build** come from third-party or community sources and must be checked once
against the real API or node before relying on them.

Decisions already taken with the owner while reviewing:

| Decision | Choice |
|---|---|
| Jev in v1 | Yes, with Haiku fallback, rolled out through a shadow mode (finding 4) |
| Tooling language | Node.js, no dependencies |
| n8n database | SQLite (n8n default) instead of Postgres |

Overall: the PRD is clear, well scoped and already follows the right principles
(human in the loop, code for facts, idempotency). Nothing below changes the product. The
changes are about cost assumptions that are out of date, n8n Community Edition limits the
PRD does not account for, and a few places where v1 can be simpler.

---

## 1. The cost model is out of date, which changes why Jev is there

**Finding.** Section 9 prices Claude Haiku 4.5 at $1 / $5 per million tokens. The current
Haiku is Claude Haiku 5.5 at **$0.10 in / $0.50 out**, with a 1M context window. The
current Sonnet is Claude Sonnet 5.5 at $2 / $10. Opus 5.5 is $4 / $20.

Back-of-envelope for this product, assuming 60 emails per day survive the rule filter at
about 2k tokens each, 3 drafts per day, one planner call per day with ~10k input tokens:

| Item | Monthly |
|---|---|
| Triage decisions (Haiku 5.5, every filtered email) | ≈ $0.40 |
| Enrichment + drafts (Haiku 5.5, action items only) | ≈ $0.30 |
| Morning planner (Sonnet 5.5, 1 call/day) | ≈ $1.00 |
| VPS (Hetzner CX22 class) | ≈ €4–5 |
| **Total** | **≈ €6–7**, against a €15 target |

**Consequence.** Jev's $0.042 per million input tokens saves cents, not euros. Its value
is calibrated confidence and the experiment itself. The "cheap by default" principle holds
with or without Jev, and the rule pre-filter is still worth having for privacy and noise,
not for money.

**Proposed change.** Update the model table to Haiku 5.5 / Sonnet 5.5 and the prices.
Reframe Jev in section 9 as "experiment with an off switch" (finding 4). Add Opus 5.5 as
the named upgrade path for the planner (≈ $2/month more).

## 2. Claude 5.5 API behaviour the workflows must respect

These are not optional; a request that ignores them returns 400 or breaks parsing.

- Adaptive thinking is **on by default**. Set `output_config.effort` per call: `low` for
  triage and enrichment, `medium` for drafts, `high` for the planner. Thinking tokens
  count toward `max_tokens`, so give headroom (1024 triage, 2048 drafts, 8000 planner).
- Structured output is `output_config: { format: { type: "json_schema", schema } }` with
  `additionalProperties: false` and all fields `required`. The first `text` block is then
  guaranteed valid JSON. This replaces the PRD's generic "structured output" wording.
- Read response content blocks by `type`, never `content[0]` (a `thinking` block may come first).
- Non-default `temperature` / `top_p` return 400 on Haiku 5.5. No assistant prefill.
- Call the API through the n8n **HTTP Request** node, not the LangChain Anthropic node;
  the node lags the API surface and hides `output_config`.

**Proposed change.** Add these to section 9 as implementation constraints; they are
already in `CLAUDE.md`.

## 3. n8n Community Edition constraints the PRD does not account for

- **Variables (`$vars`) are an Enterprise feature.** Section 8 "Config (n8n variables or a
  Notion settings page)" needs a different answer. Proposed: a committed
  `config/config.example.json`, a gitignored `config/config.local.json`, and a `Config`
  Code node in every workflow that the build script fills from it; secrets stay in n8n
  credentials, so nodes never need `$env` and environment access can stay blocked (the
  n8n 2.x default). Drop the Notion settings page:
  it adds an API round-trip and parsing to every run and gains only phone editability.
- **Notion `status` property type.** The Notion node has historically not supported
  `status` for filtering or creating pages; integrations in other tools report the same and
  recommend `select`. Proposed: `Status` is a `select` in v1. **Verify at build**; the
  fallback is an HTTP Request node against the Notion API with the same credential.
- **Gmail "Create Draft" threading.** Community reports say the node accepts a `threadId`
  and places the draft in the thread, but does not set `In-Reply-To` / `References`, so
  the recipient may see a new conversation. Proposed: pass `threadId` plus the identical
  `Re: <subject>`; **verify at build** by sending one draft to yourself; fallback is
  `drafts.create` via HTTP with a raw MIME message carrying the headers.
- **Telegram 4096-character limit.** The digest will exceed it on busy days. Split by
  section in code.
- **Gmail Trigger query** should also exclude `label:assistant/processed` so re-polls are
  cheap. Notion `Source ID` stays the real idempotency guard.

**Proposed change.** Section 8 config paragraph, section 7 WF1 step 6 and WF3 step 5, and
a short "Platform constraints" subsection in section 10.

## 4. Jev: a controlled way to try it

The owner wants to try Jev; it is early access with a non-standard API. The clean way is a
mode switch so Jev can be turned on, shadowed or off without touching any workflow.

**API shape** (third-party documentation; **verify against TypeSafe's OpenAPI spec**):
`POST https://api.typesafe.ai/v1/systemone`, Bearer key, body
`{ model: "jev-latest", state: "<text>", questions: { <name>: { type: "noul" | "choice" | "score", instructions, criteria } } }`.
All questions are answered in one call. `noul` returns P(yes); `choice` returns one of up
to 255 options with a probability. OpenRouter also serves Jev at
`https://openrouter.ai/api/v1/systemone` with the same body, which is a way in if the
direct early-access key is slow to arrive.

**Design.** `WF5 Decide` asks four questions: `action_needed` (noul), `action_type`
(choice `email_reply` / `other`), `priority` (choice P1–P3), `estimate` (choice
15/30/60/120). `DECIDER_MODE` in config:

| Mode | Behaviour | When |
|---|---|---|
| `haiku` | Claude Haiku only, same output schema | Day one, and the permanent fallback |
| `shadow` | Call Jev and Haiku; act on Haiku; store both decisions on the item | First 1–2 weeks |
| `jev` | Jev primary; fall back to Haiku on HTTP error, 10 s timeout, or `max(p, 1-p) < 0.7` on `action_needed` | After the shadow comparison looks good |

**Logging without a new database.** Add three properties to "Assistant Inbox":
`Decided by` (select Jev / Haiku), `Confidence` (number), `Shadow decision` (rich text
JSON, shadow mode only). A small script reads the database and prints agreement rate and
confidence distribution. This answers the PRD's "compare Jev and Haiku on my real data"
with no extra infrastructure. Note that Haiku's confidence is self-reported, not calibrated.

**Privacy.** Jev is a third party too. The exclusion list runs before WF5.

**Proposed change.** Replace the WF5 paragraph in sections 7 and 9 with the mode table;
add the three properties to section 8; answer open question 1 with "direct key, else
OpenRouter; test Russian and Czech in shadow mode".

## 5. Simplifications inside the workflows

- **WF2, "an optional comment in the same message or the next one".** The "next message"
  variant needs state across Telegram updates. Drop it from v1. Keep the same-message
  caption. Cheap stateless alternative for later: the bot's confirmation message carries the
  Notion page ID, so a *reply* to that message can update the item.
- **WF3 order of operations.** Save the Notion digest page, send Telegram, and only then
  close FYI items. Never close FYI items before delivery succeeded, or a failed send loses
  them silently.
- **WF3 candidate set must be bounded in code**: open items with Status Inbox / Planned /
  In progress, sorted by (overdue, P1, due within 3 days, age), capped at 40 before the
  planner call. Define "age" as days since created.
- **WF4** is n8n's built-in Error Trigger plus a Telegram node; per-node "Retry on fail"
  (3 attempts) on external-API nodes. Nothing custom.
- **Keep decision and enrichment as two calls** even when Haiku makes the decision. One
  code path is worth more than a fraction of a cent.
- **Config and pure logic live in the repo**, not in the n8n UI: Code-node functions are ES
  modules under `src/` with unit tests, injected into workflow JSON by a build script. This
  is the one piece of tooling the project adds, and it is what makes "code for facts"
  testable.

**Proposed change.** Section 7, WF2 step 3 and WF3 steps 1 and 5–6.

## 6. Hosting with SQLite

Compose becomes `n8n` + `caddy`. Environment: `GENERIC_TIMEZONE=Europe/Prague`,
`WEBHOOK_URL=https://<host>/`, `N8N_ENCRYPTION_KEY` (generated once, in the backup),
`EXECUTIONS_DATA_PRUNE=true`, `EXECUTIONS_DATA_MAX_AGE=336`,
`N8N_BLOCK_ENV_ACCESS_IN_NODE=true`, image tag pinned. Backup is a nightly tar of the n8n
volume plus `.env`, pushed with `rclone` to a Google Drive folder or any S3-compatible
bucket; do one restore test. VPS: Hetzner CX22 class, Debian 12, SSH key only, UFW with
22 and 443 only.

**Proposed change.** Section 11, replace Postgres with SQLite and add the pruning settings.

## 7. The no-send check, made precise

`scripts/check-no-send.mjs` fails when any workflow JSON contains: a Gmail node with
operation `send`, `reply` or `sendAndWait`; any `emailSend` node; a Telegram node whose
`chatId` is not the config expression; any HTTP Request to a Gmail or Telegram send
endpoint. `deploy` refuses to push when the check fails, so the rule is enforced before
anything reaches the server, not only in CI.

**Proposed change.** Section 10, Safety.

## 8. Repo hygiene for a public sample

Section 15 step 8 wants the repo to be a shareable sample. Then personal data must never be
committed in the first place: ignore and exclusion lists, chat ID, Notion database IDs and
the hostname live in `config/config.local.json` and `infra/.env`, both gitignored, and the
export script strips credential IDs, email addresses, chat IDs and webhook IDs from workflow
JSON. The friction log (`docs/NOTES.md`) is a PRD success metric, so `CLAUDE.md` makes
appending to it a rule.

## 9. Open questions, proposed answers

1. **Jev access**: direct key, else OpenRouter. Test Russian and Czech on real samples in shadow mode.
2. **Threshold**: start at 0.7, tune from the `Confidence` column after a week.
3. **Working hours / weekends**: 09:00–18:00, weekdays; weekend digest off, all in config.
4. **Lists**: start empty in `config.local.json`, grow from the first week's FYI noise.
5. **Notion database**: create new ones from `notion/schema.json`; no migration risk.
6. **VPS and subdomain**: owner's choice; the plan assumes Hetzner.

## 10. Minor notes

- LinkedIn notification emails often contain only a snippet of an InMail; the task must
  carry the conversation link, which the PRD already requires. Expect some "Reply on
  LinkedIn" tasks whose summary is thin.
- "Share of drafts sent with only minor edits" (section 13) cannot be measured
  automatically in v1. Accept a weekly manual note until the "learning from edits" item in
  section 12 exists.
- `/digest` and `/today` commands are cheap once WF3 exists; keep them in the backlog.

## Sources

- Jev / System One API shape and pricing: third-party guides and client libraries, including
  [nexos.ai guide](https://nexos.ai/blog/what-is-jev/),
  [Zuplo gateway docs](https://zuplo.com/docs/ai-gateway/jev.md),
  [kataras/jev Go client](https://github.com/kataras/jev),
  [OpenRouter Jev docs](https://openrouter.ai/docs/guides/community/jev),
  [DataCamp tutorial](https://www.datacamp.com/tutorial/jev-api-tutorial).
- Notion `status` property limitations in automation tools:
  [Gumloop thread](https://forum.gumloop.com/t/notion-updater-unable-to-update-status-select-property/2486),
  [Make thread](https://community.make.com/t/notion-search-module-filter-not-showing-status-field/55515).
- Gmail draft threading in n8n:
  [n8n community thread](https://community.n8n.io/t/gmail-create-draft-node-doesnt-create-a-real-reply/216842).
- Claude model IDs, prices and API behaviour: Anthropic API reference as of October 2026.
