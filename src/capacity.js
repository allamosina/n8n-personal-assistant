// Free-time calculation for the morning planner (WF3). Pure, no dependencies.
// All times are interpreted in the configured IANA time zone via Intl.

const DAY = 24 * 60;

/** 'HH:MM' -> minutes since midnight. */
export function hhmmToMin(s) {
  const m = String(s).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`Bad time "${s}", expected HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** minutes since midnight -> 'HH:MM'. */
export function minToHhmm(n) {
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Local calendar date ('YYYY-MM-DD') and minute-of-day of an instant in `tz`. */
export function localParts(instant, tz) {
  const d = instant instanceof Date ? instant : new Date(instant);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** Today's date in `tz` as 'YYYY-MM-DD'. */
export function todayInTz(now, tz) {
  return localParts(now, tz).date;
}

/** Minute-of-day of `instant` relative to `date`, clamped to [0, 1440]. */
function minuteOn(instant, date, tz) {
  const p = localParts(instant, tz);
  if (p.date < date) return 0;
  if (p.date > date) return DAY;
  return p.minutes;
}

function isDeclined(ev) {
  return (ev.attendees || []).some((a) => a.self && a.responseStatus === 'declined');
}

/**
 * Turn Google Calendar events into busy intervals for `date`.
 * Skips: cancelled, declined by me, and events marked "free" (transparent).
 * All-day events default to "free" in Google Calendar, so they only block the
 * day when explicitly marked busy (e.g. an out-of-office day).
 */
export function busyIntervals(events, date, tz) {
  const out = [];
  for (const ev of events || []) {
    if (ev.status === 'cancelled' || isDeclined(ev) || ev.transparency === 'transparent') continue;
    const title = ev.summary || '(no title)';
    if (ev.start?.date && !ev.start?.dateTime) {
      // All-day event: start.date inclusive, end.date exclusive.
      if (ev.start.date <= date && (ev.end?.date || ev.start.date) > date) {
        out.push({ title, start: 0, end: DAY, allDay: true });
      }
      continue;
    }
    const start = minuteOn(ev.start.dateTime, date, tz);
    const end = minuteOn(ev.end.dateTime, date, tz);
    if (end > start) out.push({ title, start, end, allDay: false });
  }
  return out.sort((a, b) => a.start - b.start);
}

function mergeIntervals(list) {
  const merged = [];
  for (const iv of [...list].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else merged.push({ start: iv.start, end: iv.end });
  }
  return merged;
}

/**
 * Compute free time for one working day.
 *
 * free_minutes is the sum of usable free slots (at least `minSlotMin` long), so
 * the number the planner and the feasibility check use is time that can actually
 * hold a task, not 5-minute crumbs between meetings.
 *
 * @param {{date: string, timezone: string, workStart: string, workEnd: string,
 *          events: object[], bufferMin?: number, minSlotMin?: number}} opts
 */
export function computeCapacity({ date, timezone, workStart, workEnd, events, bufferMin = 10, minSlotMin = 15 }) {
  const ws = hhmmToMin(workStart);
  const we = hhmmToMin(workEnd);
  if (we <= ws) throw new Error('workEnd must be after workStart');

  const busy = busyIntervals(events, date, timezone);
  // Each meeting blocks its own time plus a buffer after it, within the window.
  const blocked = mergeIntervals(
    busy
      .map((b) => ({ start: Math.max(ws, b.start), end: Math.min(we, b.allDay ? b.end : b.end + bufferMin) }))
      .filter((b) => b.end > b.start),
  );

  const slots = [];
  let cursor = ws;
  for (const b of blocked) {
    if (b.start > cursor) slots.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < we) slots.push({ start: cursor, end: we });

  const usable = slots.filter((s) => s.end - s.start >= minSlotMin);
  const meetingsInWindow = busy.filter((b) => b.end > ws && b.start < we);
  const meetingMinutes = mergeIntervals(
    meetingsInWindow.map((b) => ({ start: Math.max(ws, b.start), end: Math.min(we, b.end) })),
  ).reduce((sum, b) => sum + (b.end - b.start), 0);

  return {
    date,
    window: { start: minToHhmm(ws), end: minToHhmm(we) },
    free_minutes: usable.reduce((sum, s) => sum + (s.end - s.start), 0),
    meeting_minutes: meetingMinutes,
    free_slots: usable.map((s) => ({ start: minToHhmm(s.start), end: minToHhmm(s.end), minutes: s.end - s.start })),
    meetings: busy.map((b) => ({
      title: b.title,
      start: b.allDay ? null : minToHhmm(Math.min(b.start, DAY - 1)),
      end: b.allDay ? null : minToHhmm(Math.min(b.end, DAY - 1)),
      all_day: b.allDay,
    })),
  };
}
