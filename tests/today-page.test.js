import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkedTaskIds, blockIds, bucketItems, renderTodayBlocks, pageUrl } from '../src/today-page.js';

const mention = (id) => ({ type: 'mention', mention: { type: 'page', page: { id } } });
const blocks = [
  { id: 'b1', type: 'paragraph', paragraph: { rich_text: [] } },
  { id: 'b2', type: 'to_do', to_do: { checked: true, rich_text: [mention('task-a'), { type: 'text', text: { content: ' · 30 мин' } }] } },
  { id: 'b3', type: 'to_do', to_do: { checked: false, rich_text: [mention('task-b')] } },
  { id: 'b4', type: 'to_do', to_do: { checked: true, rich_text: [{ type: 'text', text: { content: 'typed by hand, no mention' } }] } },
  { id: 'b5', type: 'to_do', to_do: { checked: true, rich_text: [mention('task-a')] } },
];

test('checked to-dos yield the mentioned task ids once; untouched and hand-written ones do not', () => {
  assert.deepEqual(checkedTaskIds(blocks), ['task-a']);
  assert.deepEqual(blockIds(blocks), ['b1', 'b2', 'b3', 'b4', 'b5']);
  assert.deepEqual(checkedTaskIds([]), []);
  assert.deepEqual(checkedTaskIds(undefined), []);
});

const item = (id, o = {}) => ({ id, title: id, kind: 'Action', status: 'Inbox', ...o });

test('buckets by due date, skipping FYI, closed and planned items', () => {
  const items = [
    item('planned', { due: '2026-10-12' }),
    item('overdue', { due: '2026-10-01', priority: 'P3' }),
    item('today-unplanned', { due: '2026-10-12', priority: 'P1' }),
    item('tomorrow', { due: '2026-10-13' }),
    item('week', { due: '2026-10-17' }),
    item('next-week', { due: '2026-10-20' }),
    item('nodue-p1', { priority: 'P1' }),
    item('nodue-p2'),
    item('fyi', { kind: 'FYI' }),
    item('done', { status: 'Done', due: '2026-10-13' }),
  ];
  const b = bucketItems(items, { today: '2026-10-12', plannedIds: ['planned'] });
  assert.deepEqual(b.tomorrow.map((t) => t.id), ['overdue', 'today-unplanned', 'tomorrow']);
  assert.deepEqual(b.week.map((t) => t.id), ['week']);
  assert.deepEqual(b.later.map((t) => t.id), ['next-week', 'nodue-p1', 'nodue-p2']);
  assert.equal(b.later[2].priority, 'P2');
});

test('renders summary, to-dos with page mentions, and bucket headings', () => {
  const d = {
    date: '2026-10-12',
    capacity: { free_minutes: 300 },
    plan: { today: [{ id: 'a', title: 'A', slot: '09:00', estimate_min: 30, link: 'https://mail.google.com/x' }], planned_minutes: 30, note: 'Спокойный день.' },
    buckets: { tomorrow: [{ id: 'b', title: 'B', due: '2026-10-13', priority: 'P2', link: null }], week: [], later: [{ id: 'c', title: 'C', due: null, priority: 'P2', link: null }] },
  };
  const out = renderTodayBlocks(d, 'ru');
  assert.equal(out[0].type, 'paragraph');
  assert.match(out[0].paragraph.rich_text[0].text.content, /2026-10-12 · Свободно: 300 мин, запланировано: 30 мин\. Спокойный день\./);
  assert.equal(out[1].type, 'to_do');
  assert.equal(out[1].to_do.checked, false);
  assert.deepEqual(out[1].to_do.rich_text[0], mention('a'));
  assert.equal(out[1].to_do.rich_text[1].text.content, ' · 09:00 · 30 мин');
  assert.equal(out[1].to_do.rich_text[3].text.link.url, 'https://mail.google.com/x');
  assert.deepEqual(out.map((b) => b.type), ['paragraph', 'to_do', 'heading_2', 'to_do', 'heading_2', 'to_do']);
  assert.equal(out[2].heading_2.rich_text[0].text.content, 'Завтра');
  assert.equal(out[3].to_do.rich_text[1].text.content, ' · до 13.10');
  assert.equal(out[4].heading_2.rich_text[0].text.content, 'Когда-нибудь');
  const empty = renderTodayBlocks({ date: '2026-10-12', capacity: { free_minutes: 0 }, plan: { today: [] }, buckets: {} }, 'en');
  assert.deepEqual(empty.map((b) => b.type), ['paragraph', 'paragraph']);
  assert.equal(empty[1].paragraph.rich_text[0].text.content, 'Nothing planned for today.');
});

test('never more than 100 blocks; a cut group ends with a "more" line', () => {
  const many = (n, p) => Array.from({ length: n }, (_, i) => ({ id: p + i, title: p + i, due: null, priority: 'P2', link: null }));
  const out = renderTodayBlocks({ date: '2026-10-12', capacity: { free_minutes: 0 }, plan: { today: many(10, 't') }, buckets: { tomorrow: many(5, 'a'), week: many(50, 'w'), later: many(60, 'l') } });
  assert.equal(out.length, 100);
  assert.equal(out[out.length - 1].type, 'paragraph');
  assert.match(out[out.length - 1].paragraph.rich_text[0].text.content, /^… ещё \d+$/);
  const headings = out.filter((b) => b.type === 'heading_2').map((b) => b.heading_2.rich_text[0].text.content);
  assert.deepEqual(headings, ['Завтра', 'На этой неделе', 'Когда-нибудь']);
  assert.equal(out.filter((b) => b.type === 'to_do').length, 10 + 5 + 50 + 30);
  assert.equal(out[out.length - 1].paragraph.rich_text[0].text.content, '… ещё 30');
});

test('pageUrl strips dashes', () => {
  assert.equal(pageUrl('3f5adac5-6296-811d-96e2-dded26e25095'), 'https://www.notion.so/3f5adac56296811d96e2dded26e25095');
});
