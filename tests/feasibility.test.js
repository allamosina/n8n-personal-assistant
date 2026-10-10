import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enforceFeasibility, nextWorkday } from '../src/feasibility.js';

const TODAY = '2026-10-12'; // Monday
const c = (id, priority, estimate_min) => ({ id, title: id, priority, estimate_min, link: null, due: null });
const candidates = [c('a', 'P1', 60), c('b', 'P2', 60), c('c', 'P3', 30), c('d', 'P2', 30)];

test('nextWorkday skips weekends', () => {
  assert.equal(nextWorkday('2026-10-12'), '2026-10-13');
  assert.equal(nextWorkday('2026-10-16'), '2026-10-19'); // Fri → Mon
  assert.equal(nextWorkday('2026-10-16', [1, 2, 3, 4, 5, 6]), '2026-10-17');
  assert.throws(() => nextWorkday('2026-10-12', []));
});

test('a plan that fits passes through unchanged', () => {
  const r = enforceFeasibility({ today: [{ id: 'a', slot: '09:00' }, { id: 'c' }], move: [], risks: [], note: 'ok' }, { candidates, freeMinutes: 120, today: TODAY });
  assert.deepEqual(r.today.map((t) => t.id), ['a', 'c']);
  assert.equal(r.planned_minutes, 90);
  assert.equal(r.overloaded, false);
  assert.deepEqual(r.trimmed, []);
});

test('over capacity: lowest priority goes first, later one on ties, then refill', () => {
  const plan = { today: [{ id: 'a' }, { id: 'b' }, { id: 'd' }, { id: 'c' }] }; // 180 min
  const r = enforceFeasibility(plan, { candidates, freeMinutes: 100, today: TODAY, overflowReason: 'no time' });
  // Remove c (P3, 30) → 150; d (P2, later than b) → 120; b → 60. Refill: b (60) does
  // not fit, d (30) fits → 90, c (30) does not.
  assert.deepEqual(r.today.map((t) => t.id), ['a', 'd']);
  assert.deepEqual(r.trimmed, ['c', 'b']);
  assert.equal(r.planned_minutes, 90);
  assert.equal(r.proposed_minutes, 180);
  assert.equal(r.overloaded, true);
  assert.deepEqual(r.move.map((m) => m.id), ['b', 'c']);
  assert.equal(r.move[0].reason, 'no time');
  assert.equal(r.move[0].new_date, '2026-10-13');
});

test('a big task that can never fit does not push out a small one that does', () => {
  const cands = [c('big', 'P1', 120), c('small', 'P3', 15)];
  const r = enforceFeasibility({ today: [{ id: 'big' }, { id: 'small' }] }, { candidates: cands, freeMinutes: 60, today: TODAY });
  assert.deepEqual(r.today.map((t) => t.id), ['small']);
  assert.deepEqual(r.move.map((m) => m.id), ['big']);
  assert.equal(r.planned_minutes, 15);
});

test('uses candidate estimates, drops unknown and duplicate IDs', () => {
  const plan = {
    today: [{ id: 'a', estimate_min: 5 }, { id: 'ghost' }, { id: 'a' }],
    move: [{ id: 'a', reason: 'dup' }, { id: 'b', reason: 'later', new_date: '2026-10-20' }, { id: 'nope' }],
    risks: [{ id: 'b', reason: 'due soon' }, { id: 'ghost' }],
  };
  const r = enforceFeasibility(plan, { candidates, freeMinutes: 480, today: TODAY });
  assert.deepEqual(r.today.map((t) => [t.id, t.estimate_min]), [['a', 60]]);
  assert.deepEqual(r.move.map((m) => [m.id, m.new_date]), [['b', '2026-10-20']]);
  assert.deepEqual(r.risks.map((x) => x.id), ['b']);
});

test('zero free minutes moves everything', () => {
  const r = enforceFeasibility({ today: [{ id: 'a' }, { id: 'b' }] }, { candidates, freeMinutes: 0, today: TODAY });
  assert.equal(r.today.length, 0);
  assert.equal(r.move.length, 2);
});

test('empty plan is valid', () => {
  const r = enforceFeasibility({}, { candidates: [], freeMinutes: 300, today: TODAY });
  assert.deepEqual([r.today, r.move, r.risks, r.planned_minutes], [[], [], [], 0]);
});
