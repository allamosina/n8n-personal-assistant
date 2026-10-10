# Friction log

Running log of n8n limitations and the workaround chosen (PRD §13 success metric). Newest
first. Format:

```
## YYYY-MM-DD — short title
Tried: what the obvious approach was.
Problem: what failed or would fail, with a source if any.
Instead: what we did, and where it lives in the repo.
```

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
