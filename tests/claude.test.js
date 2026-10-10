import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillTemplate, buildClaudeRequest, parseClaudeResponse, usageOf } from '../src/claude.js';

const prompt = {
  system: 'You triage for {{owner_name}}.',
  user: 'Email:\n{{email}}\nItems: {{items}}',
  schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
  model_key: 'triage',
  effort: 'low',
  max_tokens: 1024,
};

test('fillTemplate substitutes strings and JSON, throws on missing', () => {
  assert.equal(fillTemplate('a {{x}} b {{ y }}', { x: '1', y: [1] }), 'a 1 b [\n  1\n]');
  assert.throws(() => fillTemplate('{{nope}}', {}), /nope/);
  assert.equal(fillTemplate('{{x}}', { x: '' }), '');
});

test('buildClaudeRequest follows the API rules', () => {
  const r = buildClaudeRequest(prompt, { owner_name: 'Owner', email: 'hi', items: [] }, { triage: 'claude-haiku-5-5' });
  assert.equal(r.model, 'claude-haiku-5-5');
  assert.equal(r.max_tokens, 1024);
  assert.equal(r.system, 'You triage for Owner.');
  assert.deepEqual(r.output_config, { effort: 'low', format: { type: 'json_schema', schema: prompt.schema } });
  for (const banned of ['temperature', 'top_p', 'top_k', 'thinking']) assert.ok(!(banned in r), banned);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].role, 'user');
  assert.throws(() => buildClaudeRequest(prompt, {}, {}), /No model/);
});

test('parseClaudeResponse reads the text block even after thinking', () => {
  const body = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 10, output_tokens: 3 }, model: 'm' };
  assert.deepEqual(parseClaudeResponse(body), { ok: true });
  assert.deepEqual(usageOf(body), { model: 'm', input_tokens: 10, output_tokens: 3 });
});

test('parseClaudeResponse surfaces refusals, truncation and API errors', () => {
  assert.throws(() => parseClaudeResponse({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }), /refused \(cyber\)/);
  assert.throws(() => parseClaudeResponse({ stop_reason: 'max_tokens', content: [{ type: 'thinking' }] }), /max_tokens/);
  assert.throws(() => parseClaudeResponse({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }), /overloaded_error busy/);
  assert.throws(() => parseClaudeResponse({ stop_reason: 'end_turn', content: [] }), /no text block/);
  assert.throws(() => parseClaudeResponse(null), /Claude API error/);
});
