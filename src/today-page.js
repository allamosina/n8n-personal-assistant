// The "Today" page (WF3): the one Notion page the owner looks at. Rewritten
// every morning: the planner's list for today as to-dos, then the other open
// tasks by due date. Before the rewrite, the to-dos she ticked are read back so
// WF3 can close those tasks. Pure.

const OPEN = ['Inbox', 'Planned', 'In progress'];
const RANK = { P1: 1, P2: 2, P3: 3 };
const NOTION_MAX_BLOCKS = 100;

const LABELS = {
  ru: { tomorrow: 'Завтра', week: 'На этой неделе', later: 'Когда-нибудь', min: 'мин', due: 'до', more: 'ещё', free: 'Свободно', planned: 'запланировано', empty: 'На сегодня ничего не запланировано.', open: 'открыть' },
  en: { tomorrow: 'Tomorrow', week: 'This week', later: 'Someday', min: 'min', due: 'due', more: 'more', free: 'Free', planned: 'planned', empty: 'Nothing planned for today.', open: 'open' },
};

export function labels(lang = 'ru') {
  return LABELS[lang] || LABELS.en;
}

/** Notion page URL from a page id, with or without dashes. */
export function pageUrl(id) {
  return 'https://www.notion.so/' + String(id || '').replace(/-/g, '');
}

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'). */
function daysBetween(from, to) {
  return Math.round((Date.parse(to.slice(0, 10) + 'T00:00:00Z') - Date.parse(from.slice(0, 10) + 'T00:00:00Z')) / 86400000);
}

/** Ids of the page's top-level blocks (GET /blocks/{page}/children results), to delete before a rewrite. */
export function blockIds(blocks) {
  return (blocks || []).map((b) => b.id).filter(Boolean);
}

/** Task page ids mentioned in to-do blocks the owner ticked. */
export function checkedTaskIds(blocks) {
  const ids = [];
  for (const b of blocks || []) {
    if (b.type !== 'to_do' || !b.to_do?.checked) continue;
    for (const rt of b.to_do.rich_text || []) {
      const id = rt.type === 'mention' && rt.mention?.type === 'page' ? rt.mention.page?.id : null;
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/**
 * Open tasks that are not in today's plan, by due date: tomorrow (overdue
 * leftovers included), this week, later. Within a bucket: earliest due, then
 * priority, then title.
 * @param {object[]} items records from fromNotionPage()
 * @param {{today: string, plannedIds?: string[], weekDays?: number, defaultPriority?: string}} opts
 */
export function bucketItems(items, { today, plannedIds = [], weekDays = 7, defaultPriority = 'P2' }) {
  const planned = new Set(plannedIds);
  const out = { tomorrow: [], week: [], later: [] };
  for (const it of items || []) {
    if (it.kind === 'FYI' || !OPEN.includes(it.status || 'Inbox') || planned.has(it.id)) continue;
    const d = it.due ? daysBetween(today, it.due) : null;
    const rec = { id: it.id, title: it.title, due: it.due || null, priority: RANK[it.priority] ? it.priority : defaultPriority, link: it.link || it.url || null };
    if (d !== null && d <= 1) out.tomorrow.push(rec);
    else if (d !== null && d <= weekDays) out.week.push(rec);
    else out.later.push(rec);
  }
  const cmp = (a, b) =>
    (a.due && b.due ? a.due.localeCompare(b.due) : a.due ? -1 : b.due ? 1 : 0) || RANK[a.priority] - RANK[b.priority] || a.title.localeCompare(b.title);
  for (const k of Object.keys(out)) out[k].sort(cmp);
  return out;
}

const text = (content, url) => ({ type: 'text', text: { content: String(content).slice(0, 1900), link: url ? { url } : null } });
const mention = (id) => ({ type: 'mention', mention: { type: 'page', page: { id } } });
const block = (type, rich_text, extra = {}) => ({ object: 'block', type, [type]: { rich_text, ...extra } });
const dueText = (due, lang) => (lang === 'ru' ? due.slice(8, 10) + '.' + due.slice(5, 7) : due);

/** One to-do: the task as a page mention (title stays live), details, link. */
function todo(t, L, lang) {
  const parts = [mention(t.id)];
  const details = [t.slot, t.estimate_min ? `${t.estimate_min} ${L.min}` : '', t.due ? `${L.due} ${dueText(t.due, lang)}` : ''].filter(Boolean);
  if (details.length) parts.push(text(' · ' + details.join(' · ')));
  if (t.link) parts.push(text(' · '), text(L.open, t.link));
  return block('to_do', parts, { checked: false });
}

/**
 * Block children for the "Today" page, at most 100 blocks: summary, today's
 * plan as to-dos, then the buckets with headings. Groups that do not fit end
 * with an "… N more" line.
 * @param {{date: string, capacity: {free_minutes: number}, plan: {today: object[], planned_minutes?: number, note?: string}, buckets: {tomorrow: object[], week: object[], later: object[]}}} d
 */
export function renderTodayBlocks(d, lang = 'ru') {
  const L = labels(lang);
  const plan = d.plan || { today: [] };
  const summary = [`${d.date} · ${L.free}: ${d.capacity?.free_minutes ?? 0} ${L.min}, ${L.planned}: ${plan.planned_minutes ?? 0} ${L.min}.`, plan.note || ''].filter(Boolean).join(' ');
  const blocks = [block('paragraph', [text(summary)])];
  if (plan.today?.length) for (const t of plan.today) blocks.push(todo(t, L, lang));
  else blocks.push(block('paragraph', [text(L.empty)]));

  for (const key of ['tomorrow', 'week', 'later']) {
    const list = d.buckets?.[key] || [];
    if (!list.length) continue;
    const room = NOTION_MAX_BLOCKS - blocks.length - 1; // minus the heading
    if (room < 1) break;
    blocks.push(block('heading_2', [text(L[key])]));
    const shown = list.length <= room ? list : list.slice(0, room - 1);
    for (const t of shown) blocks.push(todo(t, L, lang));
    if (shown.length < list.length) blocks.push(block('paragraph', [text(`… ${L.more} ${list.length - shown.length}`)]));
  }
  return blocks.slice(0, NOTION_MAX_BLOCKS);
}
