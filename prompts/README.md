# Prompts

One file per model call. `scripts/build.mjs` parses each file into an object
`{ system, user, schema, model_key, effort, max_tokens, guidance }` and injects it into the
Code node that builds the request (see `src/claude.js`).

File format:

- `## Settings` — a fenced JSON block: `model_key` (a key of `config.models`), `effort`,
  `max_tokens`.
- `## System` — system prompt. May use `{{placeholders}}`.
- `## User` — user message template with `{{placeholders}}`.
- `## Schema` — a fenced JSON block: the JSON schema for structured output. Every object
  has `additionalProperties: false` and lists all its properties in `required`.
- `## Guidance: <key>` — optional named snippets (for example per channel), available as
  `prompt.guidance.<key>`.

Everything before the first `##` heading is documentation and is not sent.

Placeholders that are not provided make the build of the request throw on purpose.
Deterministic rules (dates, arithmetic, which channel can get a Gmail draft) live in
`src/`, not in prompts.
