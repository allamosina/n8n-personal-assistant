// Rendering the morning digest (WF3) for Telegram (HTML parse mode) and for a
// Notion page (blocks). One section model, two renderers. Pure.

export const TELEGRAM_LIMIT = 4096;

const LABELS = {
  ru: {
    title: 'План на',
    meetings: 'Встречи',
    today: 'Главное на сегодня',
    move: 'Предлагаю перенести',
    risks: 'Дедлайны под угрозой',
    fyi: 'Для сведения',
    drafts: 'Черновики ждут в Gmail',
    free: 'Свободно',
    planned: 'запланировано',
    min: 'мин',
    overloaded: 'День перегружен: часть задач перенесена.',
    allDay: 'весь день',
    to: 'на',
    due: 'срок',
    empty: 'Нет открытых задач.',
    overflow: 'Не помещается в свободное время сегодня',
  },
  en: {
    title: 'Plan for',
    meetings: 'Meetings',
    today: 'Top priorities',
    move: 'Suggested to move',
    risks: 'At-risk deadlines',
    fyi: 'FYI',
    drafts: 'Drafts waiting in Gmail',
    free: 'Free',
    planned: 'planned',
    min: 'min',
    overloaded: 'The day is overloaded: some tasks were moved.',
    allDay: 'all day',
    to: 'to',
    due: 'due',
    empty: 'No open tasks.',
    overflow: 'Does not fit into free time today',
  },
};

export function labels(lang = 'ru') {
  return LABELS[lang] || LABELS.en;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Build the section model.
 * @param {{date: string, capacity: object, plan: object, fyi: object[], drafts: object[], omitted?: number}} d
 * @returns {{header: string, summary: string, sections: {key: string, heading: string, lines: {text: string, url?: string|null}[]}[]}}
 */
export function buildDigestSections(d, lang = 'ru') {
  const L = labels(lang);
  const plan = d.plan || { today: [], move: [], risks: [] };
  const summary = [
    `${L.free}: ${d.capacity.free_minutes} ${L.min}, ${L.planned}: ${plan.planned_minutes ?? 0} ${L.min}.`,
    plan.overloaded ? L.overloaded : '',
    plan.note || '',
  ]
    .filter(Boolean)
    .join(' ');

  const sections = [
    {
      key: 'meetings',
      heading: L.meetings,
      lines: (d.capacity.meetings || []).map((m) => ({ text: m.all_day ? `${L.allDay} · ${m.title}` : `${m.start}–${m.end} · ${m.title}` })),
    },
    {
      key: 'today',
      heading: L.today,
      lines: (plan.today || []).map((t) => ({
        text: `${t.slot ? t.slot + ' · ' : ''}${t.priority} · ${t.title} (${t.estimate_min} ${L.min})`,
        url: t.link,
      })),
    },
    {
      key: 'move',
      heading: L.move,
      lines: (plan.move || []).map((m) => ({ text: `${m.title} → ${L.to} ${m.new_date}${m.reason ? ' — ' + m.reason : ''}`, url: m.link })),
    },
    {
      key: 'risks',
      heading: L.risks,
      lines: (plan.risks || []).map((r) => ({ text: `${r.title} (${L.due} ${r.due})${r.reason ? ' — ' + r.reason : ''}` })),
    },
    {
      key: 'fyi',
      heading: L.fyi,
      lines: (d.fyi || []).map((f) => ({ text: f.sender ? `${f.sender}: ${f.title}` : f.title, url: f.link })),
    },
    { key: 'drafts', heading: L.drafts, lines: (d.drafts || []).map((x) => ({ text: x.title, url: x.link })) },
  ].filter((s) => s.lines.length > 0);

  if (!(plan.today || []).length && !(plan.move || []).length) {
    const at = sections[0]?.key === 'meetings' ? 1 : 0;
    sections.splice(at, 0, { key: 'today', heading: L.today, lines: [{ text: L.empty }] });
  }
  return { header: `${L.title} ${d.date}`, summary, sections };
}

function lineHtml(l) {
  const text = escapeHtml(l.text);
  return l.url ? `• <a href="${escapeHtml(l.url)}">${text}</a>` : `• ${text}`;
}

/**
 * Telegram HTML messages, each within the 4096-character limit. Splits between
 * sections first, then between lines; a single oversized line is cut.
 */
export function renderTelegram(model, limit = TELEGRAM_LIMIT) {
  const blocks = [`<b>${escapeHtml(model.header)}</b>\n${escapeHtml(model.summary)}`];
  for (const s of model.sections) {
    blocks.push([`<b>${escapeHtml(s.heading)}</b>`, ...s.lines.map(lineHtml)].join('\n'));
  }
  return splitMessage(blocks, limit);
}

/** Pack blocks into messages of at most `limit` characters. */
export function splitMessage(blocks, limit = TELEGRAM_LIMIT) {
  const pieces = [];
  for (const b of blocks) {
    if (b.length <= limit) {
      pieces.push(b);
      continue;
    }
    // Oversized block: break by lines, then hard-cut any single huge line.
    for (const line of b.split('\n')) {
      if (line.length <= limit) pieces.push(line);
      else for (let i = 0; i < line.length; i += limit) pieces.push(line.slice(i, i + limit));
    }
  }
  const out = [];
  let cur = '';
  for (const p of pieces) {
    const sep = cur ? (p.startsWith('<b>') ? '\n\n' : '\n') : '';
    if (cur && cur.length + sep.length + p.length > limit) {
      out.push(cur);
      cur = p;
    } else cur += sep + p;
  }
  if (cur) out.push(cur);
  return out;
}

const NOTION_MAX_BLOCKS = 100;

function richText(text, url) {
  return [{ type: 'text', text: { content: String(text).slice(0, 1900), link: url ? { url } : null } }];
}

/** Notion API block children for the "Daily digests" page (max 100 blocks). */
export function renderNotionBlocks(model) {
  const blocks = [{ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(model.summary) } }];
  for (const s of model.sections) {
    blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: richText(s.heading) } });
    for (const l of s.lines) {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(l.text, l.url) } });
    }
  }
  return blocks.slice(0, NOTION_MAX_BLOCKS);
}
