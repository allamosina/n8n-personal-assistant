import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigestSections, renderTelegram, renderNotionBlocks, splitMessage, escapeHtml, labels, TELEGRAM_LIMIT } from '../src/digest-format.js';

const data = {
  date: '2026-10-12',
  capacity: {
    free_minutes: 300,
    meetings: [
      { title: 'Interview <Acme>', start: '10:00', end: '11:00', all_day: false },
      { title: 'Conference', start: null, end: null, all_day: true },
    ],
  },
  plan: {
    today: [{ id: 'a', title: 'Send CV & cover letter', priority: 'P1', estimate_min: 30, slot: '09:00', link: 'https://notion.so/a' }],
    move: [{ id: 'b', title: 'Tax form', new_date: '2026-10-13', reason: 'no time', link: null }],
    risks: [{ id: 'c', title: 'Take-home', due: '2026-10-14', reason: '2h left' }],
    note: 'Busy morning.',
    planned_minutes: 30,
    overloaded: true,
  },
  fyi: [{ title: 'Statement ready', sender: 'Bank', link: 'https://mail.google.com/1' }],
  drafts: [{ title: 'Reply to recruiter', link: 'https://mail.google.com/2' }],
};

test('sections in PRD order, empty ones omitted', () => {
  const m = buildDigestSections(data, 'en');
  assert.equal(m.header, 'Plan for 2026-10-12');
  assert.deepEqual(m.sections.map((s) => s.key), ['meetings', 'today', 'move', 'risks', 'fyi', 'drafts']);
  assert.match(m.summary, /Free: 300 min, planned: 30 min\. The day is overloaded/);
  const sparse = buildDigestSections({ ...data, fyi: [], drafts: [], capacity: { free_minutes: 540, meetings: [] }, plan: { ...data.plan, risks: [] } }, 'en');
  assert.deepEqual(sparse.sections.map((s) => s.key), ['today', 'move']);
});

test('empty plan says so', () => {
  const m = buildDigestSections({ date: '2026-10-12', capacity: { free_minutes: 540, meetings: [] }, plan: { today: [], move: [], risks: [] }, fyi: [], drafts: [] }, 'ru');
  assert.equal(m.sections[0].lines[0].text, labels('ru').empty);
});

test('Russian labels by default, unknown language falls back to English', () => {
  assert.equal(buildDigestSections(data).sections[0].heading, 'Встречи');
  assert.equal(labels('cs').meetings, 'Meetings');
});

test('Telegram HTML is escaped and links are anchors', () => {
  const [msg] = renderTelegram(buildDigestSections(data, 'en'));
  assert.match(msg, /Interview &lt;Acme&gt;/);
  assert.match(msg, /<a href="https:\/\/notion\.so\/a">09:00 · P1 · Send CV &amp; cover letter \(30 min\)<\/a>/);
  assert.match(msg, /• all day · Conference/);
  assert.equal(escapeHtml('"a"'), '&quot;a&quot;');
});

test('long digests split under the limit at section boundaries', () => {
  const many = { ...data, fyi: Array.from({ length: 200 }, (_, i) => ({ title: `Newsletter number ${i} with a long subject line`, sender: 'Sender', link: `https://mail.google.com/mail/u/0/#inbox/${i}` })) };
  const msgs = renderTelegram(buildDigestSections(many, 'en'));
  assert.ok(msgs.length > 1);
  for (const m of msgs) assert.ok(m.length <= TELEGRAM_LIMIT, `chunk of ${m.length}`);
  assert.ok(msgs[0].startsWith('<b>Plan for'));
});

test('splitMessage packs and hard-cuts', () => {
  assert.deepEqual(splitMessage(['<b>a</b>', '<b>b</b>'], 100), ['<b>a</b>\n\n<b>b</b>']);
  assert.deepEqual(splitMessage(['x'.repeat(25)], 10), ['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
  assert.deepEqual(splitMessage([], 10), []);
});

test('Notion blocks: summary, headings, bullets, capped at 100', () => {
  const blocks = renderNotionBlocks(buildDigestSections(data, 'en'));
  assert.equal(blocks[0].type, 'paragraph');
  assert.equal(blocks[1].type, 'heading_2');
  const link = blocks.find((b) => b.type === 'bulleted_list_item' && b.bulleted_list_item.rich_text[0].text.link);
  assert.ok(link);
  const many = { ...data, fyi: Array.from({ length: 300 }, (_, i) => ({ title: 't' + i })) };
  assert.equal(renderNotionBlocks(buildDigestSections(many, 'en')).length, 100);
});
