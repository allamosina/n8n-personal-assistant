// n8n public API client and the pure transforms used by deploy and export.

const SETTINGS_ALLOWED = [
  'saveExecutionProgress',
  'saveManualExecutions',
  'saveDataErrorExecution',
  'saveDataSuccessExecution',
  'executionTimeout',
  'errorWorkflow',
  'timezone',
  'executionOrder',
  'callerPolicy',
];

// Triggers that require the workflow to be active. Sub-workflows (Execute
// Workflow Trigger) and the error workflow (Error Trigger) run without it.
const ACTIVATING_TRIGGERS = [
  'n8n-nodes-base.gmailTrigger',
  'n8n-nodes-base.telegramTrigger',
  'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.webhook',
];

export const ERROR_WORKFLOW_NAME = 'WF4 Error Handler';
const NAME_REF = /^name:(.+)$/;

/** Names of workflows this one calls through "name:" references. */
export function dependenciesOf(wf) {
  const deps = new Set();
  for (const n of wf.nodes || []) {
    const m = String(n.parameters?.workflowId?.value ?? '').match(NAME_REF);
    if (m) deps.add(m[1]);
  }
  return [...deps];
}

/**
 * Deploy order: the error workflow first, then every workflow after the
 * sub-workflows it calls. Ties keep file-name order. Throws on cycles.
 * @param {{file: string, workflow: object}[]} items
 */
export function deployOrder(items) {
  const byName = new Map(items.map((i) => [i.workflow.name, i]));
  const sorted = [...items].sort((a, b) => (a.workflow.name === ERROR_WORKFLOW_NAME ? -1 : b.workflow.name === ERROR_WORKFLOW_NAME ? 1 : a.file.localeCompare(b.file)));
  const out = [];
  const state = new Map();
  const visit = (item, path) => {
    const name = item.workflow.name;
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'visiting') throw new Error(`sub-workflow cycle: ${[...path, name].join(' → ')}`);
    state.set(name, 'visiting');
    for (const dep of dependenciesOf(item.workflow)) {
      if (byName.has(dep)) visit(byName.get(dep), [...path, name]);
    }
    state.set(name, 'done');
    out.push(item);
  };
  for (const item of sorted) visit(item, []);
  return out;
}

/** "WF1 Email Triage" -> "WF1-email-triage.json"; variants like "WF3b" keep their letter. */
export function fileNameFor(name) {
  return (
    String(name)
      .trim()
      .replace(/^(WF\d+)([a-z]?)\s+/i, (_, p, v) => p.toUpperCase() + v.toLowerCase() + '-')
      .replace(/[^A-Za-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .replace(/^(WF\d+[a-z]?-)(.*)$/, (_, p, rest) => p + rest.toLowerCase()) + '.json'
  );
}

export function pickSettings(settings = {}) {
  return Object.fromEntries(Object.entries(settings).filter(([k]) => SETTINGS_ALLOWED.includes(k)));
}

export function shouldActivate(wf) {
  return (wf.nodes || []).some((n) => ACTIVATING_TRIGGERS.includes(n.type) && !n.disabled);
}

function eachWorkflowRef(wf, fn) {
  for (const n of wf.nodes || []) {
    const ref = n.parameters?.workflowId;
    if (ref && typeof ref === 'object' && 'value' in ref) fn(ref, n);
  }
}

/**
 * Repo -> instance: replace "name:WF0 Upsert Item" references in Execute
 * Workflow nodes with live IDs, and point settings.errorWorkflow at WF4.
 * @param {object} wf
 * @param {Map<string, string>} idByName live workflow name -> id
 */
export function resolveForInstance(wf, idByName) {
  const out = structuredClone(wf);
  eachWorkflowRef(out, (ref, n) => {
    const m = String(ref.value).match(NAME_REF);
    if (!m) return;
    const id = idByName.get(m[1]);
    if (!id) throw new Error(`${wf.name} / ${n.name}: referenced workflow "${m[1]}" is not deployed yet`);
    ref.mode = 'id';
    ref.value = id;
    ref.cachedResultName = m[1];
  });
  out.settings = pickSettings(out.settings);
  if (wf.name !== ERROR_WORKFLOW_NAME && idByName.has(ERROR_WORKFLOW_NAME)) {
    out.settings.errorWorkflow = idByName.get(ERROR_WORKFLOW_NAME);
  }
  return out;
}

/** Instance -> repo: the reverse of resolveForInstance. */
export function resolveForRepo(wf, nameById) {
  const out = structuredClone(wf);
  eachWorkflowRef(out, (ref) => {
    const name = nameById.get(String(ref.value)) || ref.cachedResultName;
    if (!name) return;
    ref.mode = 'id';
    ref.value = `name:${name}`;
    delete ref.cachedResultName;
    delete ref.cachedResultUrl;
  });
  if (out.settings) delete out.settings.errorWorkflow;
  return out;
}

/**
 * Keep what only the instance knows: credential IDs and webhook IDs, matched by
 * node name. Credentials are attached in the n8n UI and must survive a redeploy.
 */
export function mergeLiveIdentity(repoWf, liveWf) {
  const out = structuredClone(repoWf);
  const live = new Map((liveWf?.nodes || []).map((n) => [n.name, n]));
  for (const n of out.nodes || []) {
    const l = live.get(n.name);
    if (!l) continue;
    if (l.webhookId && !n.webhookId) n.webhookId = l.webhookId;
    if (l.credentials) {
      n.credentials = n.credentials || {};
      for (const [type, cred] of Object.entries(l.credentials)) {
        if (!n.credentials[type]?.id) n.credentials[type] = cred;
      }
    }
  }
  return out;
}

/** Strip instance-specific and personal fields for committing. */
export function sanitize(wf) {
  const out = {
    name: wf.name,
    nodes: structuredClone(wf.nodes || []),
    connections: structuredClone(wf.connections || {}),
    settings: pickSettings(wf.settings),
  };
  delete out.settings.errorWorkflow;
  for (const n of out.nodes) {
    delete n.webhookId;
    delete n.id;
    for (const type of Object.keys(n.credentials || {})) {
      n.credentials[type] = { id: '', name: type };
    }
  }
  return out;
}

/** Body accepted by POST/PUT /api/v1/workflows. */
export function toApiBody(wf) {
  return { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: pickSettings(wf.settings) };
}

/** Minimal API client. Node 20+ fetch. */
export function client({ host, apiKey }) {
  if (!host || !apiKey) throw new Error('N8N_HOST and N8N_API_KEY must be set (see .env.example)');
  const base = host.replace(/\/+$/, '') + '/api/v1';
  async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { 'X-N8N-API-KEY': apiKey, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`n8n API ${method} ${path}: HTTP ${res.status} ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
  }
  return {
    async listWorkflows() {
      const all = [];
      let cursor;
      do {
        const q = new URLSearchParams({ limit: '250', ...(cursor ? { cursor } : {}) });
        const page = await call('GET', `/workflows?${q}`);
        all.push(...(page.data || []));
        cursor = page.nextCursor;
      } while (cursor);
      return all;
    },
    getWorkflow: (id) => call('GET', `/workflows/${id}`),
    createWorkflow: (wf) => call('POST', '/workflows', toApiBody(wf)),
    updateWorkflow: (id, wf) => call('PUT', `/workflows/${id}`, toApiBody(wf)),
    activate: (id) => call('POST', `/workflows/${id}/activate`),
  };
}
