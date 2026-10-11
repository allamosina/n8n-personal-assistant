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
- [x] **WF1 Email Triage created** in n8n through the connector (2026-10-10), Haiku-only
      decider, unpublished. It waits for the "Anthropic" and "Notion" credentials (To do 2
      and 5) before its test run and for your confirmation of the ignore and exclusion lists
      before publishing.
- [x] **Telegram chat ID** known (2026-10-11) and stored in `config/config.local.json`.
- [x] **WF4 Error Handler created and published** (2026-10-11), set as the error workflow of
      WF1. It sends one Telegram message per failed execution through the "Telegram account"
      credential, so it starts working as soon as that credential holds the new bot token
      (To do 1).
- [x] Hetzner server: created by mistake during setup. **Delete it** in the Hetzner console
      if not done yet, so it stops billing. Nothing on it is needed.

## To do

### 1. Telegram credential (1 minute)

- [ ] In n8n: Credentials → open the existing **"Telegram account"** → replace the Access
      Token with the new bot token from BotFather → Save. Edit this credential rather than
      creating a new one: WF4 already points at it.

### 2. Notion credential for n8n (1 minute)

n8n offers three Notion credential types. "Notion MCP OAuth2" (what the first attempt
created as "Notion account") is for n8n's Notion MCP tool and does not work here. Easiest:

- [ ] In n8n: Credentials → Create credential → search "Notion" → choose **Notion OAuth2
      API** → Connect my account → in the Notion window click "Select pages", tick
      "Assistant", Allow access → rename the credential to "Notion" → Save.

Alternative without OAuth: **Notion API** with the secret of your own integration
(notion.so/profile/integrations → New integration "n8n assistant", Internal; then on the
"Assistant" page ⋯ → Connections → Connect to → "n8n assistant"; paste the `ntn_` secret
into the credential's API Key). Claude Code points the workflows at whichever type exists.

### 3. Google Calendar credential (5 minutes)

The Gmail credential exists, so a Google Cloud OAuth client exists too. Calendar needs its
own credential with calendar scopes.

- [ ] In n8n: Credentials → Google Calendar OAuth2 API. If n8n Cloud offers "Sign in with
      Google" there, use it. Otherwise reuse the client ID and secret from the Gmail
      credential and enable the Google Calendar API in the same Google Cloud project.
- [ ] If the Google OAuth consent screen is still in "Testing", publish it to "In
      production": in Testing, Google expires the sign-in after 7 days and the workflows
      stop silently.

### 4. Gmail labels

Done, see above.

### 5. Model access (3 minutes)

Decided 2026-10-10 (see `docs/NOTES.md`): Claude is called through the HTTP Request node,
which needs an Anthropic API key. Jev uses n8n's own TypeSafe AI node, which is covered by
n8n Cloud's gateway credits, so no Jev key is needed.

- [ ] Anthropic Console (console.anthropic.com) → API keys → create a key; set a monthly
      spend limit of about $10 (expected use is about $2). In n8n: Credentials → Anthropic →
      paste the key; name the credential "Anthropic".
- [ ] Keep `decider.mode` at `haiku` until the shadow comparison in Phase 5.

### 6. Optional: n8n public API key

Only needed if the connector ever cannot do something. In n8n: Settings → n8n API → Create
an API key, then add `N8N_HOST` and `N8N_API_KEY` to the Claude Code environment settings
and the n8n host to its allowed domains.

## Not needed anymore

The `infra/` folder (Docker Compose, Caddy, backups) is kept as the self-hosting alternative
described in the PRD. It is not used while the project runs on n8n Cloud.
