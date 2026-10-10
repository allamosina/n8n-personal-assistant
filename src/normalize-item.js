// The single item contract shared by every source (input of WF0 Upsert Item),
// plus mapping to Notion API property payloads. Pure.

export const KINDS = ['Action', 'Reply', 'FYI'];
export const SOURCES = ['Gmail', 'LinkedIn', 'Telegram', 'Manual'];
export const PRIORITIES = ['P1', 'P2', 'P3'];
export const ESTIMATES = [15, 30, 60, 120];
export const STATUSES = ['Inbox', 'Planned', 'In progress', 'Done', 'Dropped'];

// Notion rich_text content is limited to 2000 characters per text object.
const RICH_TEXT_MAX = 1900;
const TITLE_MAX = 200;

function clip(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** Snap any minute value to the nearest allowed estimate bucket. */
export function snapEstimate(min) {
  const n = Number(min);
  if (!Number.isFinite(n) || n <= 0) return null;
  return ESTIMATES.reduce((best, b) => (Math.abs(b - n) < Math.abs(best - n) ? b : best), ESTIMATES[0]);
}

/** Accept YYYY-MM-DD or a full ISO timestamp; return YYYY-MM-DD or null. */
export function normalizeDate(d) {
  if (!d) return null;
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const date = new Date(`${iso}T00:00:00Z`);
  // Date rolls impossible days over (2026-02-31 → 2026-03-03); require a round trip.
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * Validate and fill an item. Throws on missing required fields so a broken
 * upstream node fails loudly (WF4 alerts) instead of writing junk to Notion.
 *
 * FYI items keep priority/estimate empty: they are not tasks.
 */
export function normalizeItem(input, defaults = {}) {
  const errors = [];
  if (!SOURCES.includes(input.source)) errors.push(`source must be one of ${SOURCES.join(', ')}`);
  if (!KINDS.includes(input.kind)) errors.push(`kind must be one of ${KINDS.join(', ')}`);
  if (input.source !== 'Manual' && !input.source_id) errors.push('source_id is required');
  if (!clip(input.title, TITLE_MAX)) errors.push('title is required');
  if (errors.length) throw new Error('Invalid item: ' + errors.join('; '));

  const isTask = input.kind !== 'FYI';
  const priority = isTask ? (PRIORITIES.includes(input.priority) ? input.priority : defaults.priority || 'P2') : null;
  const estimate = isTask ? snapEstimate(input.estimate_min) ?? defaults.estimate_min ?? 30 : null;

  return {
    source: input.source,
    source_id: input.source_id || '',
    kind: input.kind,
    title: clip(input.title, TITLE_MAX),
    summary: clip(input.summary, RICH_TEXT_MAX),
    link: input.link || null,
    sender: clip(input.sender, 300),
    due: normalizeDate(input.due),
    priority,
    priority_reason: isTask ? clip(input.priority_reason, 300) : '',
    estimate_min: estimate,
    draft_created: Boolean(input.draft_created),
    decided_by: ['Jev', 'Haiku'].includes(input.decided_by) ? input.decided_by : null,
    confidence: Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : null,
    shadow_decision: input.shadow_decision ? clip(JSON.stringify(input.shadow_decision), RICH_TEXT_MAX) : '',
    status: input.status && STATUSES.includes(input.status) ? input.status : 'Inbox',
  };
}

const rt = (s) => ({ rich_text: s ? [{ type: 'text', text: { content: s } }] : [] });
const sel = (s) => ({ select: s ? { name: s } : null });

/**
 * Notion API `properties` payload for creating a page in "Assistant Inbox".
 * Matches notion/schema.json.
 */
export function toNotionProperties(item) {
  return {
    Title: { title: [{ type: 'text', text: { content: item.title } }] },
    Kind: sel(item.kind),
    Status: sel(item.status),
    Source: sel(item.source),
    'Source ID': rt(item.source_id),
    Link: { url: item.link || null },
    Summary: rt(item.summary),
    Sender: rt(item.sender),
    Due: { date: item.due ? { start: item.due } : null },
    Priority: sel(item.priority),
    'Priority reason': rt(item.priority_reason),
    'Estimate (min)': { number: item.estimate_min },
    'Draft created': { checkbox: item.draft_created },
    'Created by': sel('Assistant'),
    'Decided by': sel(item.decided_by),
    Confidence: { number: item.confidence },
    'Shadow decision': rt(item.shadow_decision),
  };
}

/**
 * Properties to refresh when an existing item is seen again (a thread got new
 * messages). Only content fields: never status, due, priority or estimate,
 * which belong to the owner once the item exists.
 */
export function toNotionUpdateProperties(item) {
  return {
    Summary: rt(item.summary),
    ...(item.draft_created ? { 'Draft created': { checkbox: true } } : {}),
  };
}

/** Read a Notion page object (API shape) back into a flat task record. */
export function fromNotionPage(page) {
  const p = page.properties || {};
  const text = (prop) => (prop?.rich_text || prop?.title || []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');
  return {
    id: page.id,
    url: page.url || null,
    created: page.created_time || null,
    title: text(p.Title),
    kind: p.Kind?.select?.name || null,
    status: p.Status?.select?.name || null,
    source: p.Source?.select?.name || null,
    source_id: text(p['Source ID']),
    link: p.Link?.url || null,
    summary: text(p.Summary),
    sender: text(p.Sender),
    due: p.Due?.date?.start ? normalizeDate(p.Due.date.start) : null,
    priority: p.Priority?.select?.name || null,
    estimate_min: p['Estimate (min)']?.number ?? null,
    draft_created: Boolean(p['Draft created']?.checkbox),
    decided_by: p['Decided by']?.select?.name || null,
    confidence: p.Confidence?.number ?? null,
    shadow_decision: text(p['Shadow decision']),
  };
}
