import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeItem, snapEstimate, normalizeDate, toNotionProperties, toNotionUpdateProperties, fromNotionPage } from '../src/normalize-item.js';

const base = { source: 'Gmail', source_id: 'gmail:abc', kind: 'Reply', title: 'Reply to recruiter', summary: 'Asks for availability.' };

test('fills defaults for tasks, clears them for FYI', () => {
  const t = normalizeItem(base, { priority: 'P2', estimate_min: 30 });
  assert.equal(t.priority, 'P2');
  assert.equal(t.estimate_min, 30);
  assert.equal(t.status, 'Inbox');
  const f = normalizeItem({ ...base, kind: 'FYI', priority: 'P1', estimate_min: 60 });
  assert.equal(f.priority, null);
  assert.equal(f.estimate_min, null);
});

test('rejects invalid input loudly', () => {
  assert.throws(() => normalizeItem({ ...base, source: 'Slack' }), /source must be/);
  assert.throws(() => normalizeItem({ ...base, kind: 'Task' }), /kind must be/);
  assert.throws(() => normalizeItem({ ...base, source_id: '' }), /source_id/);
  assert.throws(() => normalizeItem({ ...base, title: '   ' }), /title/);
  assert.doesNotThrow(() => normalizeItem({ ...base, source: 'Manual', source_id: '' }));
});

test('snapEstimate and normalizeDate', () => {
  assert.equal(snapEstimate(45), 30);
  assert.equal(snapEstimate(50), 60);
  assert.equal(snapEstimate(500), 120);
  assert.equal(snapEstimate('x'), null);
  assert.equal(normalizeDate('2026-10-12T15:00:00+02:00'), '2026-10-12');
  assert.equal(normalizeDate('Monday'), null);
  assert.equal(normalizeDate(null), null);
});

test('clips long text to Notion limits and clamps confidence', () => {
  const t = normalizeItem({ ...base, title: 'x'.repeat(500), summary: 'y'.repeat(5000), confidence: 1.7 });
  assert.equal(t.title.length, 200);
  assert.equal(t.summary.length, 1900);
  assert.equal(t.confidence, 1);
});

test('Notion round trip keeps the fields', () => {
  const item = normalizeItem({ ...base, due: '2026-10-14', priority: 'P1', estimate_min: 15, decided_by: 'Jev', confidence: 0.91, shadow_decision: { haiku: { action_needed: true } } });
  const props = toNotionProperties(item);
  assert.equal(props.Status.select.name, 'Inbox');
  assert.equal(props['Created by'].select.name, 'Assistant');
  // Simulate what the API returns: plain_text on rich text, same select/number shapes.
  const asRead = Object.fromEntries(
    Object.entries(props).map(([k, v]) => {
      if (v.rich_text) return [k, { rich_text: v.rich_text.map((r) => ({ plain_text: r.text.content })) }];
      if (v.title) return [k, { title: v.title.map((r) => ({ plain_text: r.text.content })) }];
      return [k, v];
    }),
  );
  const back = fromNotionPage({ id: 'p1', url: 'https://notion.so/p1', created_time: '2026-10-10T08:00:00Z', properties: asRead });
  assert.equal(back.title, item.title);
  assert.equal(back.due, '2026-10-14');
  assert.equal(back.priority, 'P1');
  assert.equal(back.estimate_min, 15);
  assert.equal(back.decided_by, 'Jev');
  assert.equal(back.confidence, 0.91);
  assert.match(back.shadow_decision, /haiku/);
});

test('update never touches owner-controlled fields', () => {
  const u = toNotionUpdateProperties(normalizeItem({ ...base, draft_created: true }));
  assert.deepEqual(Object.keys(u).sort(), ['Draft created', 'Summary']);
  assert.deepEqual(Object.keys(toNotionUpdateProperties(normalizeItem(base))), ['Summary']);
});
