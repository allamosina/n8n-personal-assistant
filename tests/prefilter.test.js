import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAddress, domainMatches, prefilterEmail, trimBody } from '../src/prefilter.js';

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
