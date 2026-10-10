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
- [x] Hetzner server: created by mistake during setup. **Delete it** in the Hetzner console
      if not done yet, so it stops billing. Nothing on it is needed.

## To do

### 1. Telegram credential and chat ID (3 minutes)

- [ ] In n8n: Credentials → Telegram API → paste the new bot token; name the credential
      "Telegram bot". Delete or update the old "Telegram account" credential, whose token is
      revoked.
- [ ] Send any message to your bot in Telegram.
- [ ] Open `https://api.telegram.org/bot<token>/getUpdates` in a browser, with the bot token
      from BotFather (`/mybots` → your bot → API Token). Find `"chat":{"id":123456789,...}`
      and tell Claude Code the number. It goes into `telegram.owner_chat_id` in
      `config/config.local.json`, which is gitignored.

### 2. Notion integration for n8n (3 minutes)

- [ ] notion.so/profile/integrations → New internal integration (name it "n8n assistant"),
      capabilities: read, update, insert content. Keep the token.
- [ ] Open the "Assistant" page in Notion: ⋯ (top right) → Connections → add "n8n
      assistant". Both databases inherit the access.
- [ ] In n8n: Credentials → Notion API → paste the token; name the credential "Notion".

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
