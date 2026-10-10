// The code that guarantees the plan's arithmetic (WF3). The model proposes,
// this enforces: the sum of estimates in "today" never exceeds free minutes.

const RANK = { P1: 1, P2: 2, P3: 3 };

/** Next working day after `date` ('YYYY-MM-DD'); workDays uses 1=Mon..7=Sun. */
export function nextWorkday(date, workDays = [1, 2, 3, 4, 5]) {
  const d = new Date(date + 'T00:00:00Z');
  for (let i = 0; i < 14; i++) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (workDays.includes(dow)) return d.toISOString().slice(0, 10);
  }
  throw new Error('workDays is empty');
}

/**
 * Validate the planner's output against the candidates and free time.
 *
 * - Drops IDs that are not candidates (hallucinated or stale).
 * - Removes duplicates; an item in "today" is removed from "move".
 * - Uses the candidate's estimate, not one the model invented.
 * - While over capacity, moves the lowest-priority item (latest in the list on
 *   ties, since the model orders by importance) from "today" to "move".
 *
 * @param {{today?: object[], move?: object[], risks?: object[], note?: string}} plan
 * @param {{candidates: object[], freeMinutes: number, today: string, workDays?: number[], overflowReason?: string}} ctx
 */
export function enforceFeasibility(plan, { candidates, freeMinutes, today, workDays, overflowReason = 'Does not fit into free time today' }) {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const seen = new Set();

  const todayList = [];
  for (const t of plan.today || []) {
    const c = byId.get(t.id);
    if (!c || seen.has(t.id)) continue;
    seen.add(t.id);
    todayList.push({ id: t.id, title: c.title, priority: c.priority, estimate_min: c.estimate_min, slot: t.slot || null, link: c.link, due: c.due });
  }

  const moveList = [];
  for (const m of plan.move || []) {
    const c = byId.get(m.id);
    if (!c || seen.has(m.id)) continue;
    seen.add(m.id);
    moveList.push({ id: m.id, title: c.title, priority: c.priority, reason: m.reason || '', new_date: m.new_date || nextWorkday(today, workDays), link: c.link });
  }

  const sum = () => todayList.reduce((s, t) => s + t.estimate_min, 0);
  const proposedMinutes = sum();
  const order = new Map(todayList.map((t, i) => [t.id, i]));
  const removed = [];
  while (sum() > freeMinutes && todayList.length) {
    let idx = 0;
    todayList.forEach((t, i) => {
      if (RANK[t.priority] >= RANK[todayList[idx].priority]) idx = i;
    });
    removed.push(...todayList.splice(idx, 1));
  }
  // Greedy removal can overshoot: a big P1 that never fits pushes out a small
  // P3 that would. Put removed items back, highest priority first, if they fit.
  for (const t of [...removed].sort((a, b) => RANK[a.priority] - RANK[b.priority] || order.get(a.id) - order.get(b.id))) {
    if (sum() + t.estimate_min <= freeMinutes) {
      todayList.push(t);
      todayList.sort((a, b) => order.get(a.id) - order.get(b.id));
    }
  }
  const kept = new Set(todayList.map((t) => t.id));
  const trimmed = removed.filter((t) => !kept.has(t.id)).map((t) => t.id);
  // unshift in removal order, so the highest-priority moved item ends up first
  for (const id of trimmed) {
    const out = removed.find((t) => t.id === id);
    moveList.unshift({ id: out.id, title: out.title, priority: out.priority, reason: overflowReason, new_date: nextWorkday(today, workDays), link: out.link });
  }

  const risks = (plan.risks || []).filter((r) => byId.has(r.id)).map((r) => ({ id: r.id, title: byId.get(r.id).title, due: byId.get(r.id).due, reason: r.reason || '' }));

  return {
    today: todayList,
    move: moveList,
    risks,
    note: plan.note || '',
    free_minutes: freeMinutes,
    planned_minutes: sum(),
    proposed_minutes: proposedMinutes,
    overloaded: proposedMinutes > freeMinutes,
    trimmed,
  };
}
