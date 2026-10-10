import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCapacity, busyIntervals, localParts, todayInTz, hhmmToMin, minToHhmm } from '../src/capacity.js';

const TZ = 'Europe/Prague';
const DATE = '2026-10-12'; // Monday, CEST (+02:00)
const ev = (summary, start, end, extra = {}) => ({ summary, start: { dateTime: start }, end: { dateTime: end }, ...extra });
const opts = (events) => ({ date: DATE, timezone: TZ, workStart: '09:00', workEnd: '18:00', events, bufferMin: 10 });

test('time helpers', () => {
  assert.equal(hhmmToMin('09:30'), 570);
  assert.equal(minToHhmm(570), '09:30');
  assert.throws(() => hhmmToMin('9.30'));
  assert.deepEqual(localParts('2026-10-12T07:15:00Z', TZ), { date: '2026-10-12', minutes: 9 * 60 + 15 });
  assert.equal(todayInTz(new Date('2026-10-11T23:30:00Z'), TZ), '2026-10-12');
});

test('empty day is the whole window', () => {
  const c = computeCapacity(opts([]));
  assert.equal(c.free_minutes, 540);
  assert.deepEqual(c.free_slots, [{ start: '09:00', end: '18:00', minutes: 540 }]);
  assert.equal(c.meeting_minutes, 0);
});

test('meetings subtract their time plus a buffer, overlaps merge', () => {
  const c = computeCapacity(
    opts([
      ev('Standup', '2026-10-12T10:00:00+02:00', '2026-10-12T10:30:00+02:00'),
      ev('Interview', '2026-10-12T14:00:00+02:00', '2026-10-12T15:00:00+02:00'),
      ev('Overlap', '2026-10-12T14:30:00+02:00', '2026-10-12T15:30:00+02:00'),
    ]),
  );
  // Blocked: 10:00–10:40, 14:00–15:40 → free 09:00–10:00 (60), 10:40–14:00 (200), 15:40–18:00 (140)
  assert.equal(c.free_minutes, 400);
  assert.deepEqual(c.free_slots.map((s) => `${s.start}-${s.end}`), ['09:00-10:00', '10:40-14:00', '15:40-18:00']);
  assert.equal(c.meeting_minutes, 30 + 90);
});

test('slots shorter than 15 minutes are not counted', () => {
  const c = computeCapacity(
    opts([
      ev('A', '2026-10-12T09:00:00+02:00', '2026-10-12T10:00:00+02:00'),
      ev('B', '2026-10-12T10:20:00+02:00', '2026-10-12T18:00:00+02:00'),
    ]),
  );
  // 10:10–10:20 is a 10-minute crumb.
  assert.equal(c.free_minutes, 0);
  assert.deepEqual(c.free_slots, []);
});

test('ignores declined, cancelled and free events; all-day busy blocks the day', () => {
  const declined = ev('Declined', '2026-10-12T11:00:00+02:00', '2026-10-12T12:00:00+02:00', { attendees: [{ self: true, responseStatus: 'declined' }] });
  const cancelled = ev('Cancelled', '2026-10-12T11:00:00+02:00', '2026-10-12T12:00:00+02:00', { status: 'cancelled' });
  const free = ev('Focus (free)', '2026-10-12T11:00:00+02:00', '2026-10-12T12:00:00+02:00', { transparency: 'transparent' });
  const allDayFree = { summary: 'Holiday?', start: { date: DATE }, end: { date: '2026-10-13' }, transparency: 'transparent' };
  assert.equal(computeCapacity(opts([declined, cancelled, free, allDayFree])).free_minutes, 540);

  const ooo = { summary: 'Out of office', start: { date: DATE }, end: { date: '2026-10-13' } };
  const c = computeCapacity(opts([ooo]));
  assert.equal(c.free_minutes, 0);
  assert.equal(c.meetings[0].all_day, true);
});

test('events spanning midnight are clipped to the day', () => {
  const b = busyIntervals([ev('Overnight', '2026-10-11T22:00:00+02:00', '2026-10-12T09:30:00+02:00')], DATE, TZ);
  assert.deepEqual([b[0].start, b[0].end], [0, 570]);
  assert.equal(computeCapacity(opts([ev('Overnight', '2026-10-11T22:00:00+02:00', '2026-10-12T09:30:00+02:00')])).free_minutes, 540 - 40);
});

test('events given in UTC are converted to local time', () => {
  const c = computeCapacity(opts([ev('UTC meeting', '2026-10-12T08:00:00Z', '2026-10-12T09:00:00Z')]));
  // 10:00–11:00 local + 10 min buffer
  assert.deepEqual(c.free_slots.map((s) => `${s.start}-${s.end}`), ['09:00-10:00', '11:10-18:00']);
});

test('rejects an inverted window', () => {
  assert.throws(() => computeCapacity({ ...opts([]), workStart: '18:00', workEnd: '09:00' }), /after/);
});
