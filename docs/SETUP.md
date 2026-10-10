# Setup checklist (owner)

Manual steps that need your accounts, payments or a browser sign-in. Claude Code does the
rest. Order matters only where noted. Never paste tokens or keys into a chat: they go into
n8n credentials, the server's `infra/.env`, or the cloud environment settings.

## 1. Server and domain

- [ ] Rent a small VPS (Hetzner CX22 class, about €4/month), Debian 12 or 13, with your SSH
      public key added at creation.
- [ ] Create a DNS `A` record for the subdomain (for example `n8n.<your-domain>`) pointing at
      the VPS IP. HTTPS will not work until it resolves.
- [ ] On the server, as root:

  ```bash
  # copy the infra/ folder to the server first, e.g. scp -r infra root@<ip>:/root/
  bash /root/infra/install.sh
  cp /root/infra/{docker-compose.yml,Caddyfile,backup.sh,restore.sh} /opt/n8n-assistant/
  cp /root/infra/.env.example /opt/n8n-assistant/.env && chmod 600 /opt/n8n-assistant/.env
  # edit .env: N8N_DOMAIN, and N8N_ENCRYPTION_KEY from: openssl rand -hex 32
  cd /opt/n8n-assistant && docker compose up -d
  curl -fsS https://<your-subdomain>/healthz
  ```

- [ ] Open `https://<your-subdomain>` and create the n8n owner account.
- [ ] In n8n: Settings → n8n API → create an API key.

## 2. Backups

- [ ] Configure an rclone remote on the server (`rclone config`), for example Google Drive,
      then wrap it in a `crypt` remote named as in `RCLONE_REMOTE` in `.env`. The archive
      holds the database and the encryption key together, so it must be encrypted.
- [ ] Add the cron line from the top of `infra/backup.sh`, run `./backup.sh` once, then
      `./restore.sh backups/<archive>` to verify it.
- [ ] Store a copy of `N8N_ENCRYPTION_KEY` in your password manager.

## 3. Telegram bot

- [ ] In Telegram, talk to @BotFather: `/newbot`, choose a name; keep the token.
- [ ] Send any message to your new bot, then open
      `https://api.telegram.org/bot<token>/getUpdates` in a browser and note
      `message.chat.id`. That is `telegram.owner_chat_id` in `config/config.local.json`.
- [ ] In n8n: Credentials → Telegram API → paste the token.

## 4. Google (Gmail and Calendar)

- [ ] In Google Cloud Console: create a project, enable the Gmail API and the Google
      Calendar API.
- [ ] OAuth consent screen: External, add yourself as a test user, then **publish the app
      to "In production"**. In "Testing" status Google expires refresh tokens after 7 days
      and the workflows stop silently. An unverified app in production is fine for your own
      account; you will see a warning screen once.
- [ ] Create an OAuth client (Web application) with the redirect URI
      `https://<your-subdomain>/rest/oauth2-credential/callback`.
- [ ] In n8n: Credentials → Gmail OAuth2 and Google Calendar OAuth2 → client ID and secret →
      sign in.
- [ ] In Gmail: create the labels `assistant/processed` and `assistant/fyi`.

## 5. Notion

- [ ] notion.so/profile/integrations → New internal integration for n8n, capabilities: read,
      update and insert content. Keep the token.
- [ ] Choose or create a parent page for the two databases and add the integration under
      ⋯ → Connections.
- [ ] Tell Claude Code which page to use: it creates "Assistant Inbox" and "Daily digests"
      there through the Notion connector and writes the IDs to `config/config.local.json`.
- [ ] In n8n: Credentials → Notion API → paste the token.

## 6. Model APIs

- [ ] Anthropic Console: create an API key and set a monthly spend limit (for example $10;
      expected use is about $2). In n8n: Credentials → Header Auth, name `x-api-key`, value
      the key; call the credential "Anthropic".
- [ ] Jev: request TypeSafe early access, or use OpenRouter's Jev route and set
      `decider.jev_base_url` in config accordingly. In n8n: Credentials → Header Auth, name
      `Authorization`, value `Bearer <key>`; call it "Jev". Until a key exists, keep
      `decider.mode` at `haiku`.

## 7. Claude Code cloud sessions

- [ ] In the cloud environment settings (session title bar → environment → Edit), add the
      environment variables `N8N_HOST` (for example `https://n8n.<your-domain>`) and
      `N8N_API_KEY`, and add the n8n host under allowed domains. New sessions pick them up.

## 8. Local config

- [ ] Copy `config/config.example.json` to `config/config.local.json` and fill in owner
      details, chat ID, working hours and the first ignore and exclusion entries. The file
      is gitignored. In a cloud session, Claude Code creates it from your answers.
