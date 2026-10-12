import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectCandidates, selectFyi, selectDraftsWaiting, daysBetween } from '../src/candidates.js';

const TODAY = '2026-10-12';
const item = (id, extra = {}) => ({ id, title: id, kind: 'Action', status: 'Inbox', created: '2026-10-10T08:00:00Z', ...extra });

test('daysBetween', () => {
  assert.equal(daysBetween('2026-10-12', '2026-10-15'), 3);
  assert.equal(daysBetween('2026-10-12', '2026-10-10'), -2);
  assert.equal(daysBetween('2026-10-10T23:00:00Z', '2026-10-12'), 2);
});

test('filters closed items and FYI, fills defaults', () => {
  const { candidates } = selectCandidates(
    [item('done', { status: 'Done' }), item('dropped', { status: 'Dropped' }), item('fyi', { kind: 'FYI' }), item('manual', { status: null, priority: null, estimate_min: null, created: null })],
    { today: TODAY },
  );
  assert.deepEqual(candidates.map((c) => c.id), ['manual']);
  assert.equal(candidates[0].priority, 'P2');
  assert.equal(candidates[0].estimate_min, 30);
  assert.equal(candidates[0].status, 'Inbox');
});

test('orders overdue, due soon, priority, due date, age', () => {
  const items = [
    item('p3-old', { priority: 'P3', created: '2026-09-01T00:00:00Z' }),
    item('p1', { priority: 'P1' }),
    item('due-in-2', { priority: 'P3', due: '2026-10-14' }),
    item('overdue', { priority: 'P3', due: '2026-10-11' }),
    item('due-in-10', { priority: 'P2', due: '2026-10-22' }),
    item('p2-nodue', { priority: 'P2' }),
  ];
  const { candidates } = selectCandidates(items, { today: TODAY });
  assert.deepEqual(candidates.map((c) => c.id), ['overdue', 'due-in-2', 'p1', 'due-in-10', 'p2-nodue', 'p3-old']);
  assert.equal(candidates[0].overdue, true);
  assert.equal(candidates.at(-1).age_days, 41);
});

test('caps the list and reports how many were omitted', () => {
  const items = Array.from({ length: 50 }, (_, i) => item('t' + i));
  const r = selectCandidates(items, { today: TODAY, max: 40 });
  assert.equal(r.candidates.length, 40);
  assert.equal(r.omitted, 10);
});

test('FYI and drafts waiting', () => {
  const items = [
    item('fyi-open', { kind: 'FYI', sender: 'Bank' }),
    item('fyi-done', { kind: 'FYI', status: 'Done' }),
    item('reply-draft', { kind: 'Reply', draft_created: true, link: 'https://mail.google.com/x' }),
    item('reply-nodraft', { kind: 'Reply', draft_created: false }),
    item('action-draft', { kind: 'Action', draft_created: true }),
    item('action-nodraft', { kind: 'Action', draft_created: false }),
  ];
  assert.deepEqual(selectFyi(items).map((f) => f.id), ['fyi-open']);
  assert.deepEqual(selectDraftsWaiting(items).map((d) => d.id), ['reply-draft', 'action-draft']);
});
