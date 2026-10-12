import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJevResponse, parseHaikuDecision, needsHaiku, mergeDecision, buildJevRequest } from '../src/decide-merge.js';

const jevRaw = (p, extra = {}) => ({
  answers: {
    action_needed: { type: 'noul', noul: p },
    action_type: { type: 'choice', choice: 'email_reply', probability: 0.8 },
    priority: { type: 'choice', choice: 'P1', probability: 0.6 },
    estimate: { type: 'choice', choice: '15', probability: 0.7 },
    ...extra,
  },
});
const haikuJson = { action_needed: true, action_type: 'other', priority: 'P2', estimate_min: 60, confidence: 0.8 };

test('Jev request carries the four typed questions', () => {
  const r = buildJevRequest({ state: 'email text' });
  assert.equal(r.model, 'jev-latest');
  assert.deepEqual(Object.keys(r.questions), ['action_needed', 'action_type', 'priority', 'estimate']);
  assert.equal(r.questions.action_needed.type, 'noul');
  assert.deepEqual(Object.keys(r.questions.estimate.criteria), ['15', '30', '60', '120']);
});

test('parseJevResponse: noul confidence is max(p, 1-p); tolerant to envelope', () => {
  const j = parseJevResponse(jevRaw(0.1));
  assert.equal(j.action_needed.value, false);
  assert.equal(j.action_needed.confidence, 0.9);
  assert.equal(j.estimate.value, 15);
  const flat = parseJevResponse({ action_needed: { noul: 0.95 }, priority: { value: 'P3', confidence: 0.5 } });
  assert.equal(flat.action_needed.value, true);
  assert.equal(flat.priority.value, 'P3');
  assert.equal(flat.action_type, null);
  assert.throws(() => parseJevResponse({ answers: {} }), /action_needed/);
});

test('parseHaikuDecision accepts object or JSON string', () => {
  assert.equal(parseHaikuDecision(JSON.stringify(haikuJson)).estimate.value, 60);
  assert.throws(() => parseHaikuDecision({ action_needed: 'yes' }));
});

test('needsHaiku: only jev mode with a confident answer skips Claude', () => {
  const sure = parseJevResponse(jevRaw(0.97));
  const unsure = parseJevResponse(jevRaw(0.55));
  assert.equal(needsHaiku({ mode: 'haiku', jev: sure }), true);
  assert.equal(needsHaiku({ mode: 'shadow', jev: sure }), true);
  assert.equal(needsHaiku({ mode: 'jev', jev: sure }), false);
  assert.equal(needsHaiku({ mode: 'jev', jev: unsure }), true);
  assert.equal(needsHaiku({ mode: 'jev', jev: null, jevError: 'timeout' }), true);
  assert.equal(needsHaiku({ mode: 'jev', jev: unsure, forceActionNeeded: true }), false);
  assert.throws(() => needsHaiku({ mode: 'auto' }));
});

test('haiku mode acts on Haiku, no shadow record', () => {
  const d = mergeDecision({ mode: 'haiku', haiku: parseHaikuDecision(haikuJson) });
  assert.deepEqual([d.action_needed, d.action_type, d.priority, d.estimate_min, d.decided_by, d.confidence, d.shadow], [true, 'other', 'P2', 60, 'Haiku', 0.8, null]);
});

test('shadow mode acts on Haiku and records both', () => {
  const d = mergeDecision({ mode: 'shadow', jev: parseJevResponse(jevRaw(0.97)), haiku: parseHaikuDecision(haikuJson) });
  assert.equal(d.decided_by, 'Haiku');
  assert.equal(d.action_type, 'other');
  assert.deepEqual(d.shadow.jev, { action_needed: true, p_yes: 0.97, action_type: 'email_reply', priority: 'P1', estimate: 15 });
  assert.deepEqual(d.shadow.haiku, { action_needed: true, self_confidence: 0.8, action_type: 'other', priority: 'P2', estimate: 60 });
  // A confident "no" from Haiku must not read as a high probability of "yes".
  const no = mergeDecision({ mode: 'shadow', jev: parseJevResponse(jevRaw(0.2)), haiku: parseHaikuDecision({ action_needed: false, action_type: null, priority: null, estimate_min: null, confidence: 0.9 }) });
  assert.equal(no.shadow.haiku.self_confidence, 0.9);
  assert.equal(no.shadow.haiku.p_yes, undefined);
  const err = mergeDecision({ mode: 'shadow', jevError: 'HTTP 503', haiku: parseHaikuDecision(haikuJson) });
  assert.deepEqual(err.shadow.jev, { error: 'HTTP 503' });
  const haikuDown = mergeDecision({ mode: 'shadow', jev: parseJevResponse(jevRaw(0.97)), haikuError: 'HTTP 529' });
  assert.equal(haikuDown.decided_by, 'Jev');
  assert.equal(haikuDown.fallback_reason, 'haiku_error');
});

test('jev mode: confident Jev wins, otherwise Haiku with a reason', () => {
  const ok = mergeDecision({ mode: 'jev', jev: parseJevResponse(jevRaw(0.97)) });
  assert.deepEqual([ok.decided_by, ok.action_type, ok.priority, ok.estimate_min, ok.confidence], ['Jev', 'email_reply', 'P1', 15, 0.97]);
  const low = mergeDecision({ mode: 'jev', jev: parseJevResponse(jevRaw(0.55)), haiku: parseHaikuDecision(haikuJson) });
  assert.deepEqual([low.decided_by, low.fallback_reason], ['Haiku', 'low_confidence']);
  const down = mergeDecision({ mode: 'jev', jevError: 'timeout', haiku: parseHaikuDecision(haikuJson) });
  assert.equal(down.fallback_reason, 'jev_error');
  assert.throws(() => mergeDecision({ mode: 'jev', jevError: 'timeout' }), /No decision/);
  // Unsure Jev and a failed Haiku: keep Jev's answer rather than lose the item.
  const lastResort = mergeDecision({ mode: 'jev', jev: parseJevResponse(jevRaw(0.6)), haikuError: 'HTTP 529' });
  assert.deepEqual([lastResort.decided_by, lastResort.fallback_reason, lastResort.action_needed], ['Jev', 'low_confidence_haiku_error', true]);
});

test('no action clears the task fields', () => {
  const d = mergeDecision({ mode: 'jev', jev: parseJevResponse(jevRaw(0.02)) });
  assert.deepEqual([d.action_needed, d.action_type, d.priority, d.estimate_min], [false, null, null, null]);
});

test('Telegram forces action needed; non-Gmail channels never get email_reply', () => {
  const t = mergeDecision({ mode: 'jev', jev: parseJevResponse(jevRaw(0.3)), forceActionNeeded: true, channel: 'telegram' });
  assert.deepEqual([t.action_needed, t.action_type, t.decided_by], [true, 'other', 'Jev']);
  const li = mergeDecision({ mode: 'jev', jev: parseJevResponse(jevRaw(0.99)), channel: 'linkedin' });
  assert.equal(li.action_type, 'other');
});

test('needs_reply: a reply is drafted for email_reply, or when Haiku says the email also expects an answer', () => {
  const both = mergeDecision({ mode: 'haiku', haiku: parseHaikuDecision({ ...haikuJson, needs_reply: true }) });
  assert.deepEqual([both.action_type, both.needs_reply], ['other', true]);
  const onlyWork = mergeDecision({ mode: 'haiku', haiku: parseHaikuDecision({ ...haikuJson, needs_reply: false }) });
  assert.deepEqual([onlyWork.action_type, onlyWork.needs_reply], ['other', false]);
  const reply = mergeDecision({ mode: 'haiku', haiku: parseHaikuDecision({ ...haikuJson, action_type: 'email_reply', needs_reply: false }) });
  assert.equal(reply.needs_reply, true);
  // Never on other channels, never without action, and Jev (no such question) falls back to action_type.
  const li = mergeDecision({ mode: 'haiku', haiku: parseHaikuDecision({ ...haikuJson, needs_reply: true }), channel: 'linkedin' });
  assert.equal(li.needs_reply, false);
  assert.equal(mergeDecision({ mode: 'jev', jev: parseJevResponse(jevRaw(0.02)) }).needs_reply, false);
  assert.equal(mergeDecision({ mode: 'jev', jev: parseJevResponse(jevRaw(0.97)) }).needs_reply, true);
  const shadow = mergeDecision({ mode: 'shadow', jev: parseJevResponse(jevRaw(0.97)), haiku: parseHaikuDecision({ ...haikuJson, needs_reply: true }) });
  assert.equal(shadow.shadow.haiku.needs_reply, true);
  assert.equal('needs_reply' in shadow.shadow.jev, false);
});

test('out-of-range values fall back to defaults', () => {
  const d = mergeDecision({ mode: 'haiku', haiku: parseHaikuDecision({ action_needed: true, action_type: 'call', priority: 'P0', estimate_min: 45, confidence: 0.9 }) });
  assert.deepEqual([d.action_type, d.priority, d.estimate_min], ['other', 'P2', 30]);
});
