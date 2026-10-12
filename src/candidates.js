// Selecting what the morning planner sees (WF3). Pure.

const OPEN = ['Inbox', 'Planned', 'In progress'];
const RANK = { P1: 1, P2: 2, P3: 3 };

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'), negative if `to` is earlier. */
export function daysBetween(from, to) {
  const a = Date.parse(from.slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(to.slice(0, 10) + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

/**
 * Open tasks for the planner, enriched with computed fields and capped.
 *
 * Order: overdue, then due within `soonDays`, then priority, then earliest due,
 * then oldest. Items without status count as Inbox (manual tasks need only a
 * title), and missing priority/estimate get the defaults from the PRD.
 *
 * @param {object[]} items records from fromNotionPage()
 * @param {{today: string, max?: number, defaultPriority?: string, defaultEstimate?: number, soonDays?: number}} opts
 */
export function selectCandidates(items, { today, max = 40, defaultPriority = 'P2', defaultEstimate = 30, soonDays = 3 }) {
  const open = (items || [])
    .filter((it) => it.kind !== 'FYI' && OPEN.includes(it.status || 'Inbox'))
    .map((it) => {
      const priority = RANK[it.priority] ? it.priority : defaultPriority;
      const daysToDue = it.due ? daysBetween(today, it.due) : null;
      return {
        id: it.id,
        title: it.title,
        kind: it.kind || 'Action',
        status: it.status || 'Inbox',
        source: it.source || 'Manual',
        link: it.link || it.url || null,
        priority,
        due: it.due || null,
        days_to_due: daysToDue,
        overdue: daysToDue !== null && daysToDue < 0,
        due_soon: daysToDue !== null && daysToDue >= 0 && daysToDue <= soonDays,
        age_days: it.created ? Math.max(0, daysBetween(it.created, today)) : 0,
        estimate_min: Number(it.estimate_min) > 0 ? Number(it.estimate_min) : defaultEstimate,
      };
    });

  open.sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      Number(b.due_soon) - Number(a.due_soon) ||
      RANK[a.priority] - RANK[b.priority] ||
      (a.due && b.due ? a.due.localeCompare(b.due) : a.due ? -1 : b.due ? 1 : 0) ||
      b.age_days - a.age_days,
  );

  return { candidates: open.slice(0, max), omitted: Math.max(0, open.length - max) };
}

/** FYI items not yet shown in a digest (status still open). */
export function selectFyi(items) {
  return (items || [])
    .filter((it) => it.kind === 'FYI' && OPEN.includes(it.status || 'Inbox'))
    .map((it) => ({ id: it.id, title: it.title, sender: it.sender || '', link: it.link || it.url || null }));
}

/** Open items with a Gmail draft waiting: Reply items, and Action items that also got a draft. */
export function selectDraftsWaiting(items) {
  return (items || [])
    .filter((it) => it.kind !== 'FYI' && it.draft_created && OPEN.includes(it.status || 'Inbox'))
    .map((it) => ({ id: it.id, title: it.title, link: it.link || it.url || null }));
}
