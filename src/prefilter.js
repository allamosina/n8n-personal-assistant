// Rule pre-filter for incoming email (WF1). Runs before any model call.
// Pure: no n8n globals, no network. Injected into a Code node by scripts/build.mjs.

/**
 * Extract the bare, lower-cased address from a From header like
 * "Jane Doe <jane@example.com>" or "jane@example.com".
 * @param {string} from
 * @returns {string}
 */
export function parseAddress(from) {
  if (!from) return '';
  const angle = String(from).match(/<([^>]+)>/);
  const raw = angle ? angle[1] : String(from);
  const bare = raw.trim().match(/[^\s"<>]+@[^\s"<>]+/);
  return bare ? bare[0].toLowerCase() : '';
}

/**
 * True when the address's domain equals `domain` or is a subdomain of it.
 * @param {string} address
 * @param {string} domain
 */
export function domainMatches(address, domain) {
  const at = address.lastIndexOf('@');
  if (at < 0 || !domain) return false;
  const host = address.slice(at + 1);
  const d = domain.toLowerCase().replace(/^@/, '');
  return host === d || host.endsWith('.' + d);
}

function listHas(list, address) {
  return (list || []).some((s) => String(s).toLowerCase() === address);
}

function anyDomain(list, address) {
  return (list || []).some((d) => domainMatches(address, d));
}

/**
 * Decide what to do with an email before any model sees it.
 *
 * Order matters: the privacy exclusion list wins over everything, so an
 * excluded sender never reaches a model, even if it is also on LinkedIn.
 *
 * @param {{from: string, subject?: string}} email
 * @param {object} filters config.filters
 * @returns {{action: 'drop'|'linkedin'|'email', reason: string, address: string}}
 */
export function prefilterEmail(email, filters = {}) {
  const address = parseAddress(email.from);
  const subject = String(email.subject || '');

  if (!address) return { action: 'drop', reason: 'no_sender', address };

  if (listHas(filters.exclude_senders, address) || anyDomain(filters.exclude_domains, address)) {
    return { action: 'drop', reason: 'privacy_excluded', address };
  }
  if (listHas(filters.ignore_senders, address) || anyDomain(filters.ignore_domains, address)) {
    return { action: 'drop', reason: 'ignored', address };
  }
  if (anyDomain(filters.linkedin_domains || ['linkedin.com'], address)) {
    const alertSender = listHas(filters.linkedin_job_alert_senders, address);
    const alertSubject = (filters.linkedin_job_alert_subject_patterns || []).some((p) =>
      new RegExp(p, 'i').test(subject),
    );
    if (alertSender || alertSubject) return { action: 'drop', reason: 'linkedin_job_alert', address };
    return { action: 'linkedin', reason: 'linkedin', address };
  }
  return { action: 'email', reason: 'email', address };
}

/**
 * Trim an email body to a bounded size for model input, keeping the start
 * (where the actual request usually is) and dropping quoted history.
 * @param {string} body
 * @param {number} maxChars
 */
export function trimBody(body, maxChars = 6000) {
  let text = String(body || '').replace(/\r\n/g, '\n');
  // Cut quoted reply history: "On <date>, X wrote:" and following ">" lines.
  const quoteStart = text.search(/\n(On .{5,200} wrote:|Dne .{5,200} napsal\(a\):|.{0,100}пишет:)\s*\n/);
  if (quoteStart > 0) text = text.slice(0, quoteStart);
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text.length > maxChars ? text.slice(0, maxChars) + '\n[…truncated]' : text;
}
