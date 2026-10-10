import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNoSend, checkConventions, checkCommitted } from '../scripts/lib/checks.mjs';

const wf = (...nodes) => ({ name: 'WF', nodes, connections: {} });
const node = (type, parameters = {}, extra = {}) => ({ name: type.split('.').pop(), type, parameters, ...extra });

test('Gmail: drafts and labels pass, any send fails (including the default operation)', () => {
  assert.deepEqual(checkNoSend(wf(node('n8n-nodes-base.gmail', { resource: 'draft', operation: 'create' }))), []);
  assert.deepEqual(checkNoSend(wf(node('n8n-nodes-base.gmail', { resource: 'message', operation: 'addLabels' }))), []);
  assert.equal(checkNoSend(wf(node('n8n-nodes-base.gmail', { operation: 'send' }))).length, 1);
  assert.equal(checkNoSend(wf(node('n8n-nodes-base.gmail', { resource: 'message', operation: 'reply' }))).length, 1);
  assert.equal(checkNoSend(wf(node('n8n-nodes-base.gmail', { operation: 'sendAndWait' }))).length, 1);
  assert.equal(checkNoSend(wf(node('n8n-nodes-base.gmail', {}))).length, 1, 'default operation is send');
  assert.equal(checkNoSend(wf(node('n8n-nodes-base.gmailTool', { resource: 'message', operation: 'send' }))).length, 1);
});

test('email send nodes and send endpoints fail anywhere', () => {
  assert.equal(checkNoSend(wf(node('n8n-nodes-base.emailSend'))).length, 1);
  assert.equal(checkNoSend(wf(node('n8n-nodes-base.httpRequest', { url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send' }))).length, 1);
  assert.equal(checkNoSend(wf(node('n8n-nodes-base.httpRequest', { url: 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send' }))).length, 1);
  assert.equal(checkNoSend(wf(node('n8n-nodes-base.code', { jsCode: "await fetch('https://api.telegram.org/bot123/sendMessage')" }))).length, 1);
  assert.deepEqual(checkNoSend(wf(node('n8n-nodes-base.httpRequest', { url: 'https://gmail.googleapis.com/gmail/v1/users/me/drafts' }))), []);
});

test('Telegram must target the owner chat from config', () => {
  assert.deepEqual(checkNoSend(wf(node('n8n-nodes-base.telegram', { chatId: "={{ $('Config').first().json.telegram.owner_chat_id }}" }))), []);
  assert.equal(checkNoSend(wf(node('n8n-nodes-base.telegram', { chatId: '123456' }))).length, 1);
  assert.equal(checkNoSend(wf(node('n8n-nodes-base.telegram', { chatId: '={{ $json.message.chat.id }}' }))).length, 1);
  assert.deepEqual(checkNoSend(wf(node('n8n-nodes-base.telegramTrigger', {}))), []);
});

test('external-API nodes must retry', () => {
  assert.equal(checkConventions(wf(node('n8n-nodes-base.httpRequest', {}))).length, 1);
  assert.deepEqual(checkConventions(wf(node('n8n-nodes-base.httpRequest', {}, { retryOnFail: true }))), []);
  assert.deepEqual(checkConventions(wf(node('n8n-nodes-base.code', {}))), []);
});

test('committed JSON: no instance IDs, credential IDs, webhook IDs, injected content or personal emails', () => {
  const clean = wf(node('n8n-nodes-base.code', { jsCode: '// @inject config as CONFIG\n// @end-inject\nreturn [];' }), node('n8n-nodes-base.gmail', {}, { credentials: { gmailOAuth2: { id: '', name: 'gmailOAuth2' } } }));
  assert.deepEqual(checkCommitted(clean), []);
  assert.equal(checkCommitted({ ...clean, id: 'abc' }).length, 1);
  assert.deepEqual(checkCommitted({ ...clean, staticData: null, pinData: {} }), []);
  assert.equal(checkCommitted(wf(node('n8n-nodes-base.telegramTrigger', {}, { webhookId: 'uuid' }))).length, 1);
  assert.equal(checkCommitted(wf(node('n8n-nodes-base.gmail', {}, { credentials: { gmailOAuth2: { id: '12', name: 'Gmail me' } } }))).length, 1);
  assert.equal(checkCommitted(wf(node('n8n-nodes-base.code', { jsCode: '// @inject config as CONFIG\nconst CONFIG = {};\n// @end-inject' }))).length, 1);
  assert.equal(checkCommitted(wf(node('n8n-nodes-base.set', { value: 'someone@gmail.com' }))).length, 1);
  assert.deepEqual(checkCommitted(wf(node('n8n-nodes-base.set', { value: 'user@example.com, jobalerts-noreply@linkedin.com' }))), []);
});
