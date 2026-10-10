import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import vm from 'node:vm';
import { parsePrompt, assertStrictSchema } from '../scripts/lib/prompts.mjs';
import { findBlocks, moduleToIife, injectWorkflow, stripInjections } from '../scripts/lib/inject.mjs';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const srcFiles = readdirSync(new URL('../src/', import.meta.url)).filter((f) => f.endsWith('.js'));
const promptFiles = readdirSync(new URL('../prompts/', import.meta.url)).filter((f) => f.endsWith('.md') && f !== 'README.md');

test('every prompt file parses, with a strict schema and a known model key', () => {
  const config = JSON.parse(read('config/config.example.json'));
  assert.ok(promptFiles.length >= 4);
  for (const f of promptFiles) {
    const p = parsePrompt(read('prompts/' + f), f);
    assert.ok(p.system && p.user, f);
    assert.ok(config.models[p.model_key], `${f}: model_key "${p.model_key}" not in config.models`);
  }
  assert.ok(parsePrompt(read('prompts/decide.md')).guidance.linkedin);
});

test('prompt parser rejects malformed files', () => {
  const ok = '## Settings\n```json\n{"model_key":"triage","effort":"low","max_tokens":1024}\n```\n## System\ns\n## User\nu\n## Schema\n```json\n{"type":"object","properties":{"a":{"type":"string"}},"required":["a"],"additionalProperties":false}\n```';
  assert.doesNotThrow(() => parsePrompt(ok));
  assert.throws(() => parsePrompt(ok.replace('## User\nu\n', '')), /missing "## User"/);
  assert.throws(() => parsePrompt(ok.replace('"low"', '"tiny"')), /effort/);
  assert.throws(() => parsePrompt(ok.replace('1024', '10')), /max_tokens/);
  assert.throws(() => parsePrompt(ok.replace('"required":["a"],', '')), /required/);
  assert.throws(() => assertStrictSchema({ type: 'object', properties: { x: { type: 'object', properties: {} } }, required: ['x'], additionalProperties: false }, 'f'), /\$\.x must set additionalProperties/);
});

test('every src module injects into a self-contained IIFE that runs without imports', () => {
  for (const f of srcFiles) {
    const iife = moduleToIife(read('src/' + f), f);
    // A bare context: no require, no import, like an n8n Code node sandbox.
    const exportsObj = vm.runInNewContext(iife, { Intl, Date, JSON, Math, Number, String, Object, Array, Map, Set, RegExp, Error });
    assert.ok(Object.keys(exportsObj).length > 0, f);
    for (const fn of Object.values(exportsObj)) assert.ok(['function', 'object', 'string', 'number'].includes(typeof fn), f);
  }
});

test('injected capacity module computes the same result as the source module', async () => {
  const { computeCapacity } = await import('../src/capacity.js');
  const injected = vm.runInNewContext(moduleToIife(read('src/capacity.js'), 'capacity.js'), { Intl, Date, Math, Number, String, Object, Array, Error, RegExp });
  const opts = { date: '2026-10-12', timezone: 'Europe/Prague', workStart: '09:00', workEnd: '18:00', events: [{ summary: 'x', start: { dateTime: '2026-10-12T10:00:00+02:00' }, end: { dateTime: '2026-10-12T11:00:00+02:00' } }] };
  assert.deepEqual(JSON.parse(JSON.stringify(injected.computeCapacity(opts))), computeCapacity(opts));
});

test('moduleToIife refuses imports and default exports', () => {
  assert.throws(() => moduleToIife("import x from 'y';\nexport const a = 1;", 'f.js'), /must not import/);
  assert.throws(() => moduleToIife('export default 1;', 'f.js'), /named exports/);
  assert.throws(() => moduleToIife('const a = 1;\nexport { a };', 'f.js'), /inline/);
  assert.throws(() => moduleToIife('const a = 1;', 'f.js'), /no exports/);
});

const code = [
  "// @inject config as CONFIG",
  "// @end-inject",
  "  // @inject src/feasibility.js as feasibility",
  "  // @end-inject",
  "// @inject prompts/planner.md as PROMPT",
  "// @end-inject",
  "return [{ json: { tz: CONFIG.timezone, next: feasibility.nextWorkday('2026-10-16'), model: PROMPT.model_key } }];",
].join('\n');
const wf = { name: 'WF9 Test', nodes: [{ name: 'Code', type: 'n8n-nodes-base.code', parameters: { jsCode: code } }, { name: 'Other', type: 'n8n-nodes-base.noOp', parameters: {} }], connections: {} };

test('injectWorkflow fills blocks; the result runs; stripInjections restores the source', () => {
  const config = { $comment: 'x', timezone: 'Europe/Prague' };
  const built = injectWorkflow(wf, read, config);
  const js = built.nodes[0].parameters.jsCode;
  assert.ok(!js.includes('$comment'));
  const result = vm.runInNewContext(`(() => {\n${js}\n})()`, { Date, JSON, Math, Number, String, Object, Array, Error, RegExp, Intl });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [{ json: { tz: 'Europe/Prague', next: '2026-10-19', model: 'planner' } }]);
  // Re-injecting is idempotent.
  assert.equal(injectWorkflow(built, read, config).nodes[0].parameters.jsCode, js);
  assert.equal(stripInjections(built).nodes[0].parameters.jsCode, code);
  assert.deepEqual(wf.nodes[0].parameters.jsCode, code, 'input not mutated');
});

test('marker errors are reported with location', () => {
  assert.throws(() => findBlocks('// @inject config as A\n', 'WF / N'), /unclosed @inject config/);
  assert.throws(() => findBlocks('// @end-inject', 'WF / N'), /without @inject/);
  assert.throws(() => findBlocks('// @inject config as A\n// @inject config as B\n// @end-inject', 'x'), /nested/);
  assert.throws(() => injectWorkflow({ name: 'W', nodes: [{ name: 'C', parameters: { jsCode: '// @inject secrets.txt as S\n// @end-inject' } }] }, read, {}), /Unknown @inject target/);
});
