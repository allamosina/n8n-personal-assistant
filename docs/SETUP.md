# Setup checklist (owner)

Manual steps that need your accounts or a browser sign-in. Claude Code does the rest through
the n8n and Notion connectors. Never paste tokens or keys into a chat: they go into n8n
credentials or the Claude Code environment settings.

Status as of 2026-10-10. The project runs on **n8n Cloud** (existing Starter subscription),
not on a self-hosted server, so there is no VPS, DNS, HTTPS or backup work.

## Done

- [x] **n8n Cloud** subscription and owner account.
- [x] **n8n connector** enabled in n8n (Settings → MCP) and added in Claude
      (claude.ai → Customize → Connectors). Claude Code sees the instance, its workflows and
      the names of its credentials, never the secrets.
- [x] **Gmail credential** in n8n ("Gmail account", OAuth2).
- [x] **Gmail labels** `assistant/processed` and `assistant/fyi` created (2026-10-10); their
      IDs are in `config/config.local.json` under `gmail.labels`.
- [x] **Telegram bot** created in BotFather (2026-10-10). The first token was exposed and
      revoked; the new one still has to go into n8n (see To do 1).
- [x] **OpenRouter credential** in n8n ("OpenRouter account"). This can serve the Jev route
      (`decider.jev_base_url` set to OpenRouter) without a separate TypeSafe key.
- [x] **Notion connector** in Claude, for creating the databases.
- [x] **Notion databases created** (2026-10-10): top-level private page "Assistant" with
      "Assistant Inbox" and "Daily digests", schema as in `notion/schema.json`, plus two
      sample tasks. IDs are in `config/config.local.json`.
- [x] **WF1 Email Triage created and published** (created 2026-10-10, published 2026-10-11
      with empty ignore and exclusion lists on the owner's go-ahead). Haiku-only decider.
      Polls Gmail every 30 minutes and processes only mail that arrives after activation.
- [x] **Telegram chat ID** known (2026-10-11) and stored in `config/config.local.json`.
- [x] **WF4 Error Handler created and published** (2026-10-11), set as the error workflow of
      WF1. It sends one Telegram message per failed execution through the "Telegram account"
      credential, so it starts working as soon as that credential holds the new bot token
      (To do 1).
- [x] **Anthropic credential** in n8n ("Anthropic account", 2026-10-11), attached to the
      Claude nodes of WF1 and WF2.
- [x] **WF2 Telegram Intake created and published** (2026-10-11), WF4 as its error
      workflow. A forward or note sent to the bot becomes a task; anything from another chat
      is dropped; senders on `filters.exclude_chats` never reach a model. Publishing
      registered the bot webhook, so the "Telegram account" credential holds a working token.
- [x] **Notion credential** in n8n ("Notion account 2", Notion OAuth2, 2026-10-11),
      attached to the Notion nodes of WF1, WF2 and WF3.
- [x] **WF3 Morning Planner created** (2026-10-11), unpublished, WF4 as its error workflow,
      weekdays 07:30 Prague time. Calendar credential attached 2026-10-12; waits for the
      publish decision (To do 3).
- [x] **WF3b Morning Planner (agent) created** (2026-10-12), unpublished: the same digest
      built from n8n's AI Agent node with Notion and Calendar tools, for comparison with WF3.
      Two manual runs delivered the digest.
- [x] **WF1b Email Triage (agent) created** (2026-10-12), unpublished: WF1 rebuilt from the AI
      Agent node, native Gmail and Notion nodes and a per-email loop; pinned test passed.
      Publish either WF1 or WF1b, never both.
- [x] Hetzner server: created by mistake during setup. **Delete it** in the Hetzner console
      if not done yet, so it stops billing. Nothing on it is needed.

## To do

### 1. Telegram credential (1 minute)

- [ ] In n8n: Credentials → open the existing **"Telegram account"** → replace the Access
      Token with the new bot token from BotFather → Save. Edit this credential rather than
      creating a new one: WF4 already points at it.

### 2. Notion credential for n8n

Done (2026-10-11) as "Notion account 2", type Notion OAuth2 API. The unused "Notion account"
(Notion MCP OAuth2 type, for n8n's Notion MCP tool) can be deleted.

- [ ] **Allow the credential in HTTP Request nodes** (found 2026-10-11, execution 46: "This
      credential is configured to prevent use within an HTTP Request or GraphQL node"). In
      n8n: Credentials → open "Notion account 2" → field **Allowed HTTP Request Domains** →
      choose **Specific Domains** and enter `api.notion.com` (or choose All) → Save. The
      Notion steps of WF1, WF2 and WF3 are HTTP Request nodes and need this.

### 3. Google Calendar credential

Done (2026-10-12) as "Google Calendar account", attached to WF3 "Fetch calendar" and to the
calendar tool of WF3b.

- [ ] If the Google OAuth consent screen is still in "Testing", publish it to "In
      production": in Testing, Google expires the sign-in after 7 days and the workflows
      stop silently.
- [ ] Decide which morning planner to publish: WF3 (code computes free time) or WF3b (the
      agent does); see `docs/NOTES.md` 2026-10-12. Tell Claude Code and it publishes one.

### 4. Gmail labels

Done, see above.

### 5. Model access (3 minutes)

Decided 2026-10-10 (see `docs/NOTES.md`): Claude is called through the HTTP Request node,
which needs an Anthropic API key. Jev uses n8n's own TypeSafe AI node, which is covered by
n8n Cloud's gateway credits, so no Jev key is needed.

- [x] Anthropic Console (console.anthropic.com) → API keys → create a key. In n8n:
      Credentials → Anthropic → paste the key. Done 2026-10-11 as "Anthropic account".
- [ ] In the Anthropic Console set a monthly spend limit of about $10 (expected use is
      about $2), if not done yet.
- [ ] Keep `decider.mode` at `haiku` until the shadow comparison in Phase 5.

### 6. Optional: n8n public API key

Only needed if the connector ever cannot do something. In n8n: Settings → n8n API → Create
an API key, then add `N8N_HOST` and `N8N_API_KEY` to the Claude Code environment settings
and the n8n host to its allowed domains.

## Not needed anymore

The `infra/` folder (Docker Compose, Caddy, backups) is kept as the self-hosting alternative
described in the PRD. It is not used while the project runs on n8n Cloud.
