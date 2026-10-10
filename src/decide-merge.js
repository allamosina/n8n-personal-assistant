// WF5 Decide: turn Jev and/or Haiku answers into one decision, apply the
// DECIDER_MODE and the fallback rule, and keep the shadow record. Pure.
//
// The Jev response format is taken from third-party documentation and must be
// verified against TypeSafe's OpenAPI spec; parseJevResponse() is deliberately
// tolerant and is the only place to adjust if the real shape differs.

export const MODES = ['haiku', 'shadow', 'jev'];
const ACTION_TYPES = ['email_reply', 'other'];
const PRIORITIES = ['P1', 'P2', 'P3'];
const ESTIMATES = [15, 30, 60, 120];

/** Jev question set sent with every request. Labels are the values we act on. */
export function jevQuestions(prompts = {}) {
  return {
    action_needed: { type: 'noul', instructions: prompts.action_needed || 'Does this message require any action or reply from the recipient?' },
    action_type: {
      type: 'choice',
      instructions: prompts.action_type || 'If action is needed, what kind?',
      criteria: {
        email_reply: 'The action is to answer this email by email.',
        other: 'Anything else: prepare something, book, pay, reply on another channel.',
      },
    },
    priority: {
      type: 'choice',
      instructions: prompts.priority || 'How urgent and important is it?',
      criteria: { P1: 'Urgent and important, today or tomorrow.', P2: 'Important, this week.', P3: 'Can wait.' },
    },
    estimate: {
      type: 'choice',
      instructions: prompts.estimate || 'How long will the action take?',
      criteria: { '15': 'About 15 minutes.', '30': 'About 30 minutes.', '60': 'About an hour.', '120': 'About two hours.' },
    },
  };
}

/** Request body for POST {jev_base_url}/systemone. */
export function buildJevRequest({ model = 'jev-latest', state, prompts }) {
  return { model, state, questions: jevQuestions(prompts) };
}

function pickAnswers(raw) {
  if (!raw || typeof raw !== 'object') return {};
  return raw.answers || raw.results || raw.output || raw;
}

function choiceOf(a) {
  if (!a) return null;
  const value = a.choice ?? a.value ?? a.answer ?? null;
  const conf = a.confidence ?? a.probability ?? (a.probabilities && value != null ? a.probabilities[value] : null);
  return value == null ? null : { value: String(value), confidence: Number.isFinite(conf) ? conf : null };
}

/** Normalize a Jev response into {action_needed, action_type, priority, estimate}, each {value, confidence}. */
export function parseJevResponse(raw) {
  const a = pickAnswers(raw);
  const p = a.action_needed?.noul ?? a.action_needed?.probability ?? a.action_needed?.p;
  if (!Number.isFinite(p)) throw new Error('Jev response has no action_needed probability');
  const est = choiceOf(a.estimate);
  return {
    action_needed: { value: p >= 0.5, confidence: Math.max(p, 1 - p), p_yes: p },
    action_type: choiceOf(a.action_type),
    priority: choiceOf(a.priority),
    estimate: est ? { value: Number(est.value), confidence: est.confidence } : null,
  };
}

/** Normalize Haiku's JSON (prompts/decide.md schema) into the same shape. */
export function parseHaikuDecision(json) {
  const j = typeof json === 'string' ? JSON.parse(json) : json;
  if (typeof j?.action_needed !== 'boolean') throw new Error('Haiku decision has no boolean action_needed');
  const c = Number.isFinite(j.confidence) ? j.confidence : null;
  return {
    action_needed: { value: j.action_needed, confidence: c },
    action_type: j.action_type ? { value: j.action_type, confidence: c } : null,
    priority: j.priority ? { value: j.priority, confidence: c } : null,
    estimate: j.estimate_min ? { value: Number(j.estimate_min), confidence: c } : null,
  };
}

/**
 * Whether WF5 must call Haiku. Lets the workflow skip the Claude call when Jev
 * answered confidently in `jev` mode.
 */
export function needsHaiku({ mode, threshold = 0.7, jev, jevError, forceActionNeeded = false }) {
  if (!MODES.includes(mode)) throw new Error(`Unknown decider mode "${mode}"`);
  if (mode !== 'jev') return true;
  if (jevError || !jev) return true;
  if (forceActionNeeded) return false;
  return !(jev.action_needed.confidence >= threshold);
}

function finalize(d, forceActionNeeded, channel) {
  const actionNeeded = forceActionNeeded ? true : d.action_needed.value;
  if (!actionNeeded) return { action_needed: false, action_type: null, priority: null, estimate_min: null };
  let type = ACTION_TYPES.includes(d.action_type?.value) ? d.action_type.value : 'other';
  // Only Gmail replies can be drafted. A LinkedIn or Telegram reply is a task
  // to answer on that channel, so it is always "other" (PRD §7, LinkedIn branch).
  if (channel !== 'email' && type === 'email_reply') type = 'other';
  const prio = PRIORITIES.includes(d.priority?.value) ? d.priority.value : 'P2';
  const est = ESTIMATES.includes(d.estimate?.value) ? d.estimate.value : 30;
  return { action_needed: true, action_type: type, priority: prio, estimate_min: est };
}

// Jev reports a calibrated P(yes); Haiku a self-reported confidence in its own
// answer. They are different measures, so they are stored under different names.
function compact(d, source) {
  if (!d) return null;
  const measure = source === 'jev' ? { p_yes: d.action_needed?.p_yes ?? null } : { self_confidence: d.action_needed?.confidence ?? null };
  return {
    action_needed: d.action_needed?.value ?? null,
    ...measure,
    action_type: d.action_type?.value ?? null,
    priority: d.priority?.value ?? null,
    estimate: d.estimate?.value ?? null,
  };
}

/**
 * Combine the answers into one decision.
 *
 * @param {{mode: string, threshold?: number, jev?: object|null, jevError?: string|null,
 *          haiku?: object|null, haikuError?: string|null, forceActionNeeded?: boolean,
 *          channel?: 'email'|'linkedin'|'telegram'}} input
 *   jev/haiku are already normalized by parseJevResponse / parseHaikuDecision.
 * @returns decision with decided_by, confidence, fallback_reason and shadow record
 */
export function mergeDecision({ mode, threshold = 0.7, jev = null, jevError = null, haiku = null, haikuError = null, forceActionNeeded = false, channel = 'email' }) {
  if (!MODES.includes(mode)) throw new Error(`Unknown decider mode "${mode}"`);

  let primary;
  let decidedBy;
  let fallbackReason = null;

  if (mode === 'jev') {
    const jevOk = jev && !jevError && (forceActionNeeded || jev.action_needed.confidence >= threshold);
    if (jevOk) {
      primary = jev;
      decidedBy = 'Jev';
    } else {
      fallbackReason = jevError || !jev ? 'jev_error' : 'low_confidence';
      primary = haiku;
      decidedBy = 'Haiku';
      // Haiku failed too: a low-confidence Jev answer beats losing the item.
      if (!haiku && jev && !jevError) {
        primary = jev;
        decidedBy = 'Jev';
        fallbackReason = 'low_confidence_haiku_error';
      }
    }
  } else {
    // haiku and shadow both act on Haiku; shadow falls back to Jev if Haiku failed.
    primary = haiku;
    decidedBy = 'Haiku';
    if (!haiku && mode === 'shadow' && jev && !jevError) {
      primary = jev;
      decidedBy = 'Jev';
      fallbackReason = 'haiku_error';
    }
  }

  if (!primary) {
    throw new Error(`No decision available (mode=${mode}, jevError=${jevError || 'none'}, haikuError=${haikuError || 'none'})`);
  }

  const shadow =
    mode === 'shadow'
      ? { jev: jevError ? { error: jevError } : compact(jev, 'jev'), haiku: haikuError ? { error: haikuError } : compact(haiku, 'haiku') }
      : null;

  return {
    ...finalize(primary, forceActionNeeded, channel),
    decided_by: decidedBy,
    confidence: primary.action_needed?.confidence ?? null,
    fallback_reason: fallbackReason,
    shadow,
  };
}
