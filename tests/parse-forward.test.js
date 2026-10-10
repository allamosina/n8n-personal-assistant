import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOwner, describeOrigin, isExcludedOrigin, parseTelegramMessage } from '../src/parse-forward.js';

const OWNER = '123456789';
const base = { message_id: 42, date: 1791612000, chat: { id: 123456789, type: 'private' }, from: { id: 123456789, is_bot: false } };

test('isOwner requires private chat with the owner', () => {
  assert.ok(isOwner(base, OWNER));
  assert.ok(isOwner(base, 123456789));
  assert.ok(!isOwner({ ...base, chat: { id: 999, type: 'private' }, from: { id: 999 } }, OWNER));
  assert.ok(!isOwner({ ...base, chat: { id: 123456789, type: 'group' } }, OWNER));
  assert.ok(!isOwner(base, undefined));
  assert.ok(!isOwner({ ...base, from: { id: 5 } }, OWNER));
});

test('forward from a user', () => {
  const m = { ...base, text: 'Can you send the slides by Friday?', forward_origin: { type: 'user', date: 1791600000, sender_user: { id: 77, first_name: 'Anna', last_name: 'K', username: 'annak' } } };
  const r = parseTelegramMessage(m);
  assert.equal(r.kind, 'forward');
  assert.equal(r.sender, 'Anna K (@annak)');
  assert.equal(r.source_id, 'tg:123456789:42');
  assert.equal(r.original_date, new Date(1791600000 * 1000).toISOString());
  assert.equal(r.link, null);
});

test('forward from hidden user, chat and channel', () => {
  assert.equal(describeOrigin({ type: 'hidden_user', sender_user_name: 'Someone' }).name, 'Someone');
  assert.equal(describeOrigin({ type: 'chat', sender_chat: { id: -100, title: 'Team' }, author_signature: 'Bob' }).name, 'Team (Bob)');
  const ch = describeOrigin({ type: 'channel', chat: { id: -1001, title: 'News', username: 'newsch' }, message_id: 9 });
  assert.equal(ch.link, 'https://t.me/newsch/9');
  assert.equal(describeOrigin(null).name, null);
});

test('media caption is used as text', () => {
  const r = parseTelegramMessage({ ...base, caption: 'invoice', forward_origin: { type: 'hidden_user', sender_user_name: 'X', date: 1 } });
  assert.equal(r.text, 'invoice');
});

test('own note and reply to bot', () => {
  assert.equal(parseTelegramMessage({ ...base, text: 'Buy a gift for Mia' }).kind, 'note');
  const r = parseTelegramMessage({ ...base, text: 'deadline is Monday', reply_to_message: { message_id: 40, from: { is_bot: true } } });
  assert.equal(r.kind, 'reply');
  assert.equal(r.reply_to_message_id, 40);
});

test('exclusion by display name covers hidden accounts', () => {
  assert.ok(isExcludedOrigin({ type: 'hidden_user', sender_user_name: 'Anna K' }, ['name:anna k']));
  assert.ok(isExcludedOrigin({ type: 'user', sender_user: { id: 1, first_name: 'Anna', last_name: 'K' } }, ['name:Anna K']));
  assert.ok(isExcludedOrigin({ type: 'chat', sender_chat: { id: -5, title: 'Family' } }, ['name:family']));
  assert.ok(!isExcludedOrigin({ type: 'hidden_user', sender_user_name: 'Anna' }, ['name:anna k', 'anna k']));
});

test('chat origin without a title has no "undefined" in the name', () => {
  assert.equal(describeOrigin({ type: 'chat', sender_chat: { id: -1 }, author_signature: 'Bob' }).name, '(Bob)');
  assert.equal(describeOrigin({ type: 'chat', sender_chat: { id: -1 } }).name, null);
});

test('exclusion by id or username', () => {
  const origin = { type: 'user', sender_user: { id: 77, username: 'AnnaK' } };
  assert.ok(isExcludedOrigin(origin, ['77']));
  assert.ok(isExcludedOrigin(origin, ['@annak']));
  assert.ok(!isExcludedOrigin(origin, ['78']));
  assert.ok(!isExcludedOrigin({ type: 'hidden_user', sender_user_name: 'x' }, ['77']));
});
