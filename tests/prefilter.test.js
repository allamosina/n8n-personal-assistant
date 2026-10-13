import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAddress, domainMatches, prefilterEmail, trimBody, isBulkMail } from '../src/prefilter.js';

const filters = {
  ignore_senders: ['news@shop.example'],
  ignore_domains: ['receipts.example'],
  exclude_senders: ['therapist@private.example'],
  exclude_domains: ['bank.example'],
  linkedin_domains: ['linkedin.com'],
  linkedin_job_alert_senders: ['jobalerts-noreply@linkedin.com'],
  linkedin_job_alert_subject_patterns: ['new jobs? (for|match)'],
};

test('parseAddress handles display names, case and bare addresses', () => {
  assert.equal(parseAddress('Jane Doe <Jane@Example.com>'), 'jane@example.com');
  assert.equal(parseAddress('jane@example.com'), 'jane@example.com');
  assert.equal(parseAddress('"Doe, Jane" <jane@example.com>'), 'jane@example.com');
  assert.equal(parseAddress(''), '');
  assert.equal(parseAddress(undefined), '');
});

test('domainMatches covers subdomains but not lookalikes', () => {
  assert.ok(domainMatches('a@linkedin.com', 'linkedin.com'));
  assert.ok(domainMatches('a@e.linkedin.com', 'linkedin.com'));
  assert.ok(!domainMatches('a@notlinkedin.com', 'linkedin.com'));
  assert.ok(domainMatches('a@bank.example', '@bank.example'));
});

test('privacy exclusion wins over everything', () => {
  assert.deepEqual(prefilterEmail({ from: 'Therapist <therapist@private.example>' }, filters).reason, 'privacy_excluded');
  assert.equal(prefilterEmail({ from: 'alerts@mail.bank.example' }, filters).reason, 'privacy_excluded');
  const both = { ...filters, exclude_domains: ['linkedin.com'] };
  assert.equal(prefilterEmail({ from: 'x@linkedin.com' }, both).action, 'drop');
});

test('ignore list drops', () => {
  assert.equal(prefilterEmail({ from: 'news@shop.example' }, filters).reason, 'ignored');
  assert.equal(prefilterEmail({ from: 'no-reply@receipts.example' }, filters).reason, 'ignored');
});

test('LinkedIn routing and job-alert drop', () => {
  assert.equal(prefilterEmail({ from: 'messages-noreply@linkedin.com', subject: 'Anna sent you a message' }, filters).action, 'linkedin');
  assert.equal(prefilterEmail({ from: 'jobalerts-noreply@linkedin.com', subject: 'x' }, filters).reason, 'linkedin_job_alert');
  assert.equal(prefilterEmail({ from: 'jobs@linkedin.com', subject: '5 new jobs for Product Manager' }, filters).reason, 'linkedin_job_alert');
});

test('ordinary email passes, missing sender drops', () => {
  assert.equal(prefilterEmail({ from: 'Recruiter <r@company.example>' }, filters).action, 'email');
  assert.equal(prefilterEmail({ from: '' }, filters).reason, 'no_sender');
  assert.equal(prefilterEmail({ from: 'a@b.example' }).action, 'email');
});

test('trimBody cuts quoted history and caps length', () => {
  const body = 'Hi, can you send the CV?\n\nOn Mon, 6 Oct 2026 at 10:00, Me <me@x.example> wrote:\n> old text';
  assert.equal(trimBody(body), 'Hi, can you send the CV?');
  const long = 'a'.repeat(100);
  assert.equal(trimBody(long, 10), 'a'.repeat(10) + '\n[…truncated]');
});

test('mass mail is dropped before any model call: list headers or an unsubscribe footer', () => {
  const gmailHeaders = { 'list-unsubscribe': 'List-Unsubscribe: <https://shop.example/u>', from: 'From: Shop <hello@shop.example>' };
  assert.equal(prefilterEmail({ from: 'Shop <hello@shop.example>', headers: gmailHeaders }, filters).reason, 'bulk');
  assert.equal(prefilterEmail({ from: 'x@portal.example', headers: { 'list-id': 'List-Id: <news.portal.example>' } }, filters).reason, 'bulk');
  assert.equal(prefilterEmail({ from: 'x@portal.example', headers: { precedence: 'Precedence: bulk' } }, filters).reason, 'bulk');
  // Sreality-style: no list headers, only "odhlásit" in the footer (seen live 2026-10-12).
  assert.equal(prefilterEmail({ from: 'info@sreality.example', headers: {}, text: 'Hezký den, nové inzeráty. Můžete se odhlásit ze zasílání.' }, filters).reason, 'bulk');
  assert.equal(prefilterEmail({ from: 'x@brand.example', html: '<a href="u">Отписаться</a>' }, filters).reason, 'bulk');
  // A personal mail and a transactional notification carry neither.
  assert.equal(prefilterEmail({ from: 'teacher@school.example', headers: { from: 'From: teacher@school.example' }, text: 'Zoom link for today' }, filters).action, 'email');
  assert.equal(prefilterEmail({ from: 'NOREPLY@dpd.example', text: 'Dnes Vám doručíme balíček.' }, filters).action, 'email');
  // LinkedIn notifications also carry list headers but keep their own channel; job alerts still drop.
  assert.equal(prefilterEmail({ from: 'messages-noreply@linkedin.com', headers: gmailHeaders }, filters).action, 'linkedin');
  // Allow-listed domains and the off switch.
  assert.equal(prefilterEmail({ from: 'hello@shop.example', headers: gmailHeaders }, { ...filters, bulk_allow_domains: ['shop.example'] }).action, 'email');
  assert.equal(prefilterEmail({ from: 'hello@shop.example', headers: gmailHeaders }, { ...filters, drop_bulk: false }).action, 'email');
  assert.equal(isBulkMail({}), false);
});
