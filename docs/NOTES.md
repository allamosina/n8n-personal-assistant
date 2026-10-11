# Friction log

Running log of n8n limitations and the workaround chosen (PRD §13 success metric). Newest
first. Format:

```
## YYYY-MM-DD — short title
Tried: what the obvious approach was.
Problem: what failed or would fail, with a source if any.
Instead: what we did, and where it lives in the repo.
```

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
