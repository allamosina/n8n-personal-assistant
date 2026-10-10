// Safety and hygiene checks over workflow JSON. Used by `npm run check`, by
// `npm run deploy` (blocks the push) and in CI.

import { findBlocks } from './inject.mjs';

const GMAIL_TYPES = ['n8n-nodes-base.gmail', 'n8n-nodes-base.gmailTool'];
const EMAIL_SEND_TYPES = ['n8n-nodes-base.emailSend', 'n8n-nodes-base.emailSendTool'];
const TELEGRAM_TYPES = ['n8n-nodes-base.telegram', 'n8n-nodes-base.telegramTool'];
const GMAIL_SEND_OPS = ['send', 'reply', 'sendAndWait'];

// Endpoints that send. Matched anywhere in a workflow (URLs, Code nodes).
// Any googleapis.com host (gmail., www., upload paths) and Telegram methods
// that deliver a message: send*, forward*, copy*.
const SEND_ENDPOINTS = [
  /googleapis\.com\/(?:upload\/)?gmail\/[^\s"']*\/(?:messages|drafts)\/send/i,
  /api\.telegram\.org\/bot[^\s"']*\/(?:send|forward|copy)\w*/i,
];

// External-API node types that must retry (CLAUDE.md, workflow conventions).
const RETRY_TYPES = [
  'n8n-nodes-base.httpRequest',
  'n8n-nodes-base.notion',
  'n8n-nodes-base.gmail',
  'n8n-nodes-base.telegram',
  'n8n-nodes-base.googleCalendar',
];

// The only accepted Telegram target: the owner chat from the Config node.
export const OWNER_CHAT_EXPR = /^=\{\{\s*\$\(\s*['"]Config['"]\s*\)\.first\(\)\.json\.telegram\.owner_chat_id\s*\}\}$/;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Addresses that may appear in committed workflows (examples, public no-reply senders).
const EMAIL_ALLOW = [/@example\.(com|org|net)$/i, /@linkedin\.com$/i, /@n8n\.io$/i];

/**
 * No-send rules. Applies to source and built workflows alike.
 * @returns {string[]} violations
 */
export function checkNoSend(wf) {
  const v = [];
  const where = (n) => `${wf.name} / ${n.name}`;
  for (const n of wf.nodes || []) {
    const p = n.parameters || {};
    if (GMAIL_TYPES.includes(n.type)) {
      // Gmail node v2 defaults: resource "message", operation "send". A missing
      // operation on the message resource therefore means send.
      const resource = p.resource || 'message';
      const op = p.operation ?? (resource === 'message' ? 'send' : undefined);
      if (GMAIL_SEND_OPS.includes(op) || (resource === 'draft' && op === 'send')) {
        v.push(`${where(n)}: Gmail operation "${op}" sends email; only drafts are allowed`);
      }
    }
    if (EMAIL_SEND_TYPES.includes(n.type)) v.push(`${where(n)}: ${n.type} sends email`);
    if (TELEGRAM_TYPES.includes(n.type) && 'chatId' in p) {
      if (!OWNER_CHAT_EXPR.test(String(p.chatId).trim())) {
        v.push(`${where(n)}: Telegram chatId must be exactly ={{ $('Config').first().json.telegram.owner_chat_id }}`);
      }
    }
  }
  const text = JSON.stringify(wf);
  for (const re of SEND_ENDPOINTS) {
    const m = text.match(re);
    if (m) v.push(`${wf.name}: call to a send endpoint (${m[0]})`);
  }
  return v;
}

/** Convention checks: retries on external calls (at least 3 tries; n8n's default is 3). */
export function checkConventions(wf) {
  const v = [];
  for (const n of wf.nodes || []) {
    if (!RETRY_TYPES.includes(n.type)) continue;
    if (!n.retryOnFail) v.push(`${wf.name} / ${n.name}: external-API node must have "Retry on fail" enabled`);
    else if ((n.maxTries ?? 3) < 3) v.push(`${wf.name} / ${n.name}: "Retry on fail" needs at least 3 tries`);
  }
  return v;
}

/**
 * Hygiene for committed workflow JSON (workflows/): nothing instance-specific
 * or personal, and inject blocks empty.
 */
export function checkCommitted(wf) {
  const v = [];
  const where = (n) => `${wf.name} / ${n.name}`;
  for (const k of ['id', 'versionId', 'pinData', 'staticData', 'shared', 'homeProject']) {
    if (wf[k] !== undefined && wf[k] !== null && !(typeof wf[k] === 'object' && !Object.keys(wf[k]).length)) {
      v.push(`${wf.name}: remove instance field "${k}" (run npm run export, or strip it)`);
    }
  }
  for (const n of wf.nodes || []) {
    if (n.webhookId) v.push(`${where(n)}: remove webhookId`);
    for (const [type, cred] of Object.entries(n.credentials || {})) {
      if (cred && cred.id) v.push(`${where(n)}: remove credential id for ${type}`);
    }
    const code = n.parameters?.jsCode;
    if (typeof code === 'string') {
      const lines = code.split('\n');
      for (const b of findBlocks(code, where(n))) {
        if (lines.slice(b.start + 1, b.end).some((l) => l.trim())) v.push(`${where(n)}: inject block "${b.target}" must be empty in committed JSON`);
      }
    }
  }
  const emails = (JSON.stringify(wf).match(EMAIL_RE) || []).filter((e) => !EMAIL_ALLOW.some((re) => re.test(e)));
  if (emails.length) v.push(`${wf.name}: personal email addresses present (${[...new Set(emails)].join(', ')})`);
  return v;
}
