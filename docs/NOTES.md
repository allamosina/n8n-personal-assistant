# Friction log

Running log of n8n limitations and the workaround chosen (PRD §13 success metric). Newest
first. Format:

```
## YYYY-MM-DD — short title
Tried: what the obvious approach was.
Problem: what failed or would fail, with a source if any.
Instead: what we did, and where it lives in the repo.
```

## 2026-10-12 — WF1b: email triage rebuilt with n8n's own building blocks

Tried (owner's request, after WF3b): a copy of WF1 Email Triage from native parts.
`workflows/WF1b-email-triage-agent.json`, instance id `Hd0kMaVa4Cm1qZ26`, unpublished.
Gmail Trigger → Config and Prefilter stay Code nodes (the privacy gate must run before any
model call, hard rule 7, and the rules are tested in `src/prefilter.js`) → Loop Over Items
(one email at a time) → one **AI Agent** call (Claude Haiku 5.5, adaptive thinking, low
effort, Structured Output Parser) that decides, writes title/summary/due and, for replies,
the draft text → Switch (FYI / Reply / Action) → native Gmail "create draft" → native
Notion "get many" filtered on Source ID (Always Output Data) → If exists → native Notion
update or create (two create nodes: task and FYI) → If due date → Notion update → Gmail
"add labels" → back to the loop. 18 nodes, 3 groups.

Findings (pinned test run, execution 59; no live Gmail poll yet):
- One model call per email instead of up to three (decide, enrich, draft), so cheaper per
  email; the price is one big prompt and one schema instead of three small, tested ones.
- The per-email loop is needed because native "get many" nodes lose the item pairing on
  empty results (zero rows for two emails would collapse into one placeholder). HTTP
  Request nodes always return one response per input, which is why WF1 has no loop.
- A Notion date property cannot be left empty in the create node, so the due date is a
  separate If + update step. Priority and estimate get the config defaults in the
  expression when the model returns an empty value.
- `decide-merge.js` rules (Telegram always action, LinkedIn never email_reply) are prompt
  text here, not code; `normalize-item.js` clipping of long titles/summaries is absent.
- The Code node pinned test cannot exercise the agent, Gmail or Notion nodes; a real
  verdict needs a published run on real mail.

Decision pending, together with WF3 vs WF3b: only one triage workflow may be published,
otherwise every email gets two Notion rows and two drafts.

## 2026-10-12 — WF3b: the planner rebuilt with n8n's own building blocks

Tried (owner's request): a copy of WF3 Morning Planner made of native n8n parts instead of
Code + HTTP Request nodes: AI Agent node (Claude Sonnet 5.5 through the Anthropic Chat
Model node, adaptive thinking, effort high) with a Notion Tool ("Open tasks", filter fixed
in the node, no AI-filled parameters) and a Google Calendar Tool ("Today's calendar"), a
Structured Output Parser with the digest schema, then native Notion nodes for the digest
page and for closing FYI items, and the Telegram node. `workflows/WF3b-morning-planner-agent.json`,
instance id `SeIkODNwNdWyEKfV`, unpublished.

Findings from two manual runs (executions 54 and 57):
- Works end to end: 14–20 s per run, about 5 500 tokens (Sonnet), digest in Telegram with
  meetings, free minutes and linked tasks, page in "Daily digests" via Markdown content.
- Google Calendar resource locator: `mode: "id"` with the value `primary` fails with
  "Calendar parameter's value is invalid" (the id mode validates a calendar address).
  `mode: "list"` with value `primary` passes the keyword through and the API accepts it.
  WF3 "Fetch calendar" had the same bug; the owner pointed it at her calendar from the
  list in the UI (the committed WF3 JSON still says `primary`; switch it to list mode
  before the next export so no address lands in git).
- When the calendar tool failed, the agent did not stop: it wrote the digest with a
  warning and 540 free minutes. Convenient, but it means a broken tool produces a
  plausible plan instead of an error; WF3's code path fails loudly and WF4 reports it.
- The arithmetic (free slots, buffers, "fits into the day") is done by the model, not by
  code; `capacity.js` / `feasibility.js` are not used, so the plan is not guaranteed to
  fit. The prompt and schema live in the node parameters, not in `prompts/`.
- The credential-domain restriction does not apply: tool and Notion nodes use the OAuth
  credential directly, no "Allowed HTTP Request Domains" needed.
- Cost: Anthropic API key as before; the Anthropic Chat Model node can run on n8n Cloud
  gateway credits only with a gateway-managed credential created in the UI.

Decision pending: keep WF3 (deterministic capacity, tested code) or WF3b (fewer parts,
model does the arithmetic). Only one of them should be published.

## 2026-10-11 — Credentials are blocked in HTTP Request nodes by default

Tried: the Notion OAuth2 credential on the HTTP Request nodes of the Upsert group (the Notion
node had been ruled out for `status` and filter reasons, see below).
Problem: the first full production run of WF1 (execution 46) reached "Find existing" and
stopped with "This credential is configured to prevent use within an HTTP Request or
GraphQL node". Every credential has an **Allowed HTTP Request Domains** setting (All /
Specific Domains / None); new credentials default to None, and the connector cannot change
it. The item itself was fine: decision, enrichment and the Gmail draft all worked.
Instead: the owner sets the field to Specific Domains = `api.notion.com` (`docs/SETUP.md`
§2). Fallback if n8n Cloud refuses it for OAuth credentials: switch the three Notion HTTP
nodes to the native Notion node v3 (`databasePage` getAll with a `Source ID` filter, create,
update). Noted for later: "Create draft" runs before the Upsert group, so a retry of a run
that failed in Notion creates a second Gmail draft; the draft step should check "Find
existing" first.

## 2026-10-11 — Anthropic structured output rejects `enum` on a nullable type array

Tried: nullable enums in the prompt schemas as `"type": ["string", "null"], "enum": [...,
null]`, which is valid JSON Schema.
Problem: the first production run of WF1 (execution 42) failed at "Claude decide" with
HTTP 400 `output_config.format.schema: Invalid schema: Enum value 'email_reply' does not
match declared type '['string', 'null']'`. The API's schema validator does not accept
`enum` combined with a type array. Nothing before the call was wrong, and WF4 reported it.
Instead: nullable fields use `anyOf: [{ "type": ..., "enum": [...] }, { "type": "null" }]`
(`prompts/decide.md`, `prompts/enrich.md`); `assertStrictSchema` in
`scripts/lib/prompts.mjs` now rejects the failing shape so `npm test` and `npm run build`
catch it. Only the `Config` node bodies changed on the instance (re-uploaded and
republished for WF1 and WF2).

## 2026-10-11 — Credential types on n8n Cloud, and an empty calendar day

Notion: n8n offers three Notion credential types. The owner's first click produced
"Notion MCP OAuth2" (for the Notion MCP tool node), which the HTTP Request node cannot use.
The internal-integration route (Notion API type) needs a token copied from Notion, so the
**Notion OAuth2 API** type ("Connect my account", pick the "Assistant" page) was used
instead; the HTTP Request nodes take it as `nodeCredentialType: notionOAuth2Api`. Switching
is one `setNodeParameter` + `setNodeCredential` per node; the committed JSON records the type.

Credential auto-assignment: `create_workflow_from_code` attaches credentials to app nodes
but skips HTTP Request nodes, so their credentials are written explicitly in the SDK code
or set afterwards with `setNodeCredential`.

Google Calendar in WF3: a day without events makes the Calendar node output zero items,
which would stop the workflow before the planner runs. The node has "Always output data"
on, and `Prepare planner input` drops the empty placeholder item (`filter(e => e && e.id)`).

Error workflows cannot be tested with a real error through the connector (manual runs do not
trigger them); WF4 was tested with pinned Error Trigger data instead.

## 2026-10-10 — Export through the connector instead of the public API

Tried: `npm run export` against the n8n Cloud instance from the Claude Code container.
Problem: the container's network policy does not reach `*.app.n8n.cloud`, and the public
API would also need an API key in the environment settings.
Instead: the connector's `get_workflow_details` returns the full workflow; its result is
saved to a file and `npm run export -- --from <file>` runs the same sanitizer, inject
stripping and hygiene checks on it. The live Code-node bodies were compared with
`npm run build` output afterwards: identical, so the repo stays the source of truth.

Also: one `update_workflow` call with the full SDK code of a 70 KB workflow is too large for
the connector, so WF1 was created as a skeleton with empty Code nodes and the bodies were
filled with `updateNodeParameters` per node. Config and prompts live only in the `Config`
node; the other Code nodes read `$('Config').first().json`.

## 2026-10-10 — Claude through HTTP Request, Jev through the TypeSafe AI node

Tried: n8n's Anthropic node (`@n8n/n8n-nodes-langchain.anthropic`, text/message) so that
n8n Cloud's gateway credits could pay for Claude without an API key.
Problem: the node has no structured-output option (no `output_config.format`), and it
sends `temperature`, `topP` and `topK` defaults that Haiku 5.5 rejects with a 400.
Instead: HTTP Request node to `POST /v1/messages` with the body built by `src/claude.js`,
authenticated with the predefined `anthropicApi` credential type (so an Anthropic API key
is needed; see `docs/SETUP.md`). If a gateway-managed Anthropic credential turns out to be
selectable on the HTTP Request node, use it and drop the key.

Jev: n8n ships an official TypeSafe AI node (`@typesafe-ai/n8n-nodes-typesafe-ai.typeSafeAi`,
operation `evaluate`, `questionsFormat: json`, simplified output = value + confidence per
question), listed among the gateway-credit nodes. The Decide group uses it instead of a
hand-built HTTP call; `src/decide-merge.js` builds the questions and reads the answers.

## 2026-10-10 — Notion node v3 supports the status property type

Tried: nothing yet; noted while reading the node definition.
Finding: the Notion node v3 (`databasePage` create/update/getAll) has `statusValue` and a
`status` filter type, so the old limitation is gone. `Status` stays a `select` because the
databases already exist that way and a select is simpler to filter; revisit only if the
owner wants Notion's status groups (To-do / In progress / Complete).

## 2026-10-10 — n8n Cloud instead of a VPS; sub-workflows count as executions

Tried: self-hosted n8n on a Hetzner VPS as the PRD specifies. The server came up, but
Chrome flags free DuckDNS addresses as dangerous, and the owner already pays for n8n Cloud.
Problem: a second n8n for €7/month plus DNS, HTTPS and backups, for nothing.
Instead: n8n Cloud through the n8n connector; the server is deleted and `infra/` kept as an
alternative. Consequence: the Starter quota is 2 500 executions per month and every
sub-workflow call is one execution, so the PRD's WF0 and WF5 sub-workflows become node
groups reused inside WF1 and WF2.

## 2026-10-10 — Code nodes cannot import modules

Tried: keeping Code-node logic as tested ES modules and importing them in n8n.
Problem: a Code node is a single script in a sandbox; it cannot `import` repo files.
Instead: marker injection. `// @inject src/x.js as x` blocks are filled by
`npm run build`; a test runs every module in a bare VM context to keep them injectable.

## 2026-10-10 — No Variables in Community Edition

Tried: n8n Variables (`$vars`) for working hours, lists and model names (PRD §8).
Problem: Variables are an Enterprise feature.
Instead: `config/config.local.json` injected into a `Config` Code node per workflow at
build time. Secrets stay in credentials, so `$env` is not needed and env access in nodes
stays blocked (n8n 2.x default).

## 2026-10-10 — Notion `status` property

Tried: a Notion `status` property for task status (PRD §8).
Problem: no-code Notion integrations (n8n's node among them) have not reliably supported
`status` for filters and page creation.
Instead: `Status` is a `select` in `notion/schema.json`. Re-check against the n8n 2.42
Notion node when building WF0.

## 2026-10-10 — Gmail draft threading (to verify in WF1)

Tried: Gmail node "Create Draft" with a `threadId`.
Problem: community reports say the node does not set `In-Reply-To` / `References`, so the
recipient may see a new conversation.
Instead: pass `threadId` and the exact `Re: <subject>`; verify with a draft to self. If it
does not thread, create the draft through the Gmail API with a raw MIME message.

## 2026-10-12 — Notion API cannot replace a page's content

Tried: rewriting the "Сегодня" page in one call every morning.
Problem: the Notion API only appends children (`PATCH /blocks/{page}/children`); there
is no "replace" and a block can only be deleted one at a time (`DELETE /blocks/{id}`).
Instead: WF3 lists the page's top-level blocks (max 100; the page is rendered to stay under
that), deletes them with one HTTP Request node in batches of 3 per second, then appends the
new blocks in a single request (`executeOnce`). A first run on an empty page skips the
deletion through an If node, so the append still runs. A side effect worth having: the
same listing gives the to-dos the owner ticked, which is how tasks get closed.

## 2026-10-12 — Google Calendar node and "primary"

Tried: `calendar` in id mode with the value `primary` (committed WF3 JSON since Phase 4).
Problem: the node rejects `primary` in id mode; the owner fixed the live node by picking her
calendar from the list, which puts her address into the node (and would land in git on export).
Instead: the committed JSON uses list mode with the value `primary`, the form WF3b verified;
the live node keeps the owner's choice. Exports of WF3 are checked for the address.

## 2026-10-12 — Gmail Trigger headers, and mass mail without list headers

Tried: dropping newsletters before the model by the `List-Unsubscribe` header.
Problem: the n8n Gmail Trigger (Simplify off) does deliver `headers`, as an object with
lower-cased keys whose values are the raw header lines (`"List-Id: <...>"`), so the value
has to be stripped of its own name. And some senders (Sreality's saved-search digest, seen
in execution 72) send mass mail with no list headers at all, only an "odhlásit" link in the
footer.
Instead: `src/prefilter.js` `isBulkMail` checks `List-Unsubscribe`, `List-Id` and
`Precedence`, then falls back to unsubscribe phrases in the body in several languages.
`filters.bulk_allow_domains` keeps platforms that must still be triaged; `filters.drop_bulk`
turns the rule off.

