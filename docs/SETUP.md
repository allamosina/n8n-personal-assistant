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
- [x] **Telegram credential** in n8n ("Telegram account"), so a bot already exists.
- [x] **OpenRouter credential** in n8n ("OpenRouter account"). This can serve the Jev route
      (`decider.jev_base_url` set to OpenRouter) without a separate TypeSafe key.
- [x] **Notion connector** in Claude, for creating the databases.
- [x] Hetzner server: created by mistake during setup. **Delete it** in the Hetzner console
      if not done yet, so it stops billing. Nothing on it is needed.

## To do

### 1. Telegram chat ID (2 minutes)

- [ ] Send any message to your bot in Telegram.
- [ ] Open `https://api.telegram.org/bot<token>/getUpdates` in a browser, with the bot token
      from BotFather (`/mybots` → your bot → API Token). Find `"chat":{"id":123456789,...}`
      and tell Claude Code the number. It goes into `telegram.owner_chat_id` in
      `config/config.local.json`, which is gitignored.

### 2. Notion (5 minutes)

- [ ] Pick or create a parent page in Notion for the two databases and tell Claude Code its
      name. Claude Code creates "Assistant Inbox" and "Daily digests" there from
      `notion/schema.json`.
- [ ] notion.so/profile/integrations → New internal integration, capabilities: read, update,
      insert content. Keep the token.
- [ ] On the parent page: ⋯ → Connections → add the integration.
- [ ] In n8n: Credentials → Notion API → paste the token.

### 3. Google Calendar credential (5 minutes)

The Gmail credential exists, so a Google Cloud OAuth client exists too. Calendar needs its
own credential with calendar scopes.

- [ ] In n8n: Credentials → Google Calendar OAuth2 API. If n8n Cloud offers "Sign in with
      Google" there, use it. Otherwise reuse the client ID and secret from the Gmail
      credential and enable the Google Calendar API in the same Google Cloud project.
- [ ] If the Google OAuth consent screen is still in "Testing", publish it to "In
      production": in Testing, Google expires the sign-in after 7 days and the workflows
      stop silently.

### 4. Gmail labels (1 minute)

- [ ] In Gmail: create the labels `assistant/processed` and `assistant/fyi`.

### 5. Model access (decide with Claude Code in the build phase)

n8n Cloud lists Anthropic and TypeSafe AI (Jev) among its built-in "gateway" credential
types, billed through n8n credits. Claude Code checks during Phase 4 whether that path
supports structured output; if it does, no API keys are needed at all.

- [ ] Fallback only: Anthropic API key with a monthly spend limit (about $10; expected use
      is about $2). In n8n: Credentials → Header Auth, name `x-api-key`, call it "Anthropic".
- [ ] Jev: the OpenRouter credential covers it. Keep `decider.mode` at `haiku` until the
      shadow comparison in Phase 5.

### 6. Optional: n8n public API key

Only needed if the connector ever cannot do something. In n8n: Settings → n8n API → Create
an API key, then add `N8N_HOST` and `N8N_API_KEY` to the Claude Code environment settings
and the n8n host to its allowed domains.

## Not needed anymore

The `infra/` folder (Docker Compose, Caddy, backups) is kept as the self-hosting alternative
described in the PRD. It is not used while the project runs on n8n Cloud.
