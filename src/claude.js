// Building Claude Messages API requests and reading responses inside n8n
// Code nodes. The HTTP Request node sends the body; this module makes sure the
// body follows the rules in CLAUDE.md (structured output, effort, no sampling
// parameters) and that the response is read safely. Pure.

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Replace {{name}} placeholders. Missing variables throw: a silently empty
 * placeholder produces confident nonsense from the model.
 */
export function fillTemplate(template, vars = {}) {
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, name) => {
    if (!(name in vars) || vars[name] === undefined) throw new Error(`Missing template variable "${name}"`);
    const v = vars[name];
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  });
}

/**
 * Request body for POST /v1/messages.
 * @param {{system: string, user: string, schema: object, model_key: string, effort: string, max_tokens: number}} prompt
 *   a prompt object produced by scripts/build.mjs from prompts/*.md
 * @param {object} vars template variables
 * @param {object} models config.models (model_key -> model ID)
 */
export function buildClaudeRequest(prompt, vars, models) {
  const model = models?.[prompt.model_key];
  if (!model) throw new Error(`No model configured for "${prompt.model_key}"`);
  return {
    model,
    max_tokens: prompt.max_tokens,
    system: fillTemplate(prompt.system, vars),
    messages: [{ role: 'user', content: fillTemplate(prompt.user, vars) }],
    output_config: {
      effort: prompt.effort,
      format: { type: 'json_schema', schema: prompt.schema },
    },
  };
}

/**
 * Parse a Messages API response body into the structured JSON object.
 * Reads content by block type (thinking blocks may come first) and turns
 * refusals and truncation into explicit errors so WF4 reports them.
 */
export function parseClaudeResponse(body) {
  if (!body || body.type === 'error') {
    throw new Error(`Claude API error: ${body?.error?.type || 'unknown'} ${body?.error?.message || ''}`.trim());
  }
  if (body.stop_reason === 'refusal') {
    throw new Error(`Claude refused (${body.stop_details?.category || 'no category'})`);
  }
  if (body.stop_reason === 'max_tokens') {
    throw new Error('Claude response hit max_tokens; raise max_tokens or lower effort in the prompt file');
  }
  const text = (body.content || []).find((b) => b.type === 'text');
  if (!text) throw new Error('Claude response has no text block');
  return JSON.parse(text.text);
}

/** Usage numbers worth logging per call. */
export function usageOf(body) {
  const u = body?.usage || {};
  return { model: body?.model || null, input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0 };
}
