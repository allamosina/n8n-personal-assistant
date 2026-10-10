#!/usr/bin/env node
// Export workflows from n8n into workflows/, sanitized for committing:
// instance IDs, credential IDs and webhook IDs removed, sub-workflow references
// turned into "name:<workflow name>", inject blocks emptied.
//   npm run export                     all workflows whose name starts with "WF"
//   npm run export -- WF3              one workflow
//   npm run export -- --from <file>    one workflow from a saved JSON file (a public-API
//                                      workflow object, or the n8n connector's
//                                      get_workflow_details result), no network needed

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from './lib/env.mjs';
import { client, sanitize, resolveForRepo, fileNameFor } from './lib/n8n.mjs';
import { stripInjections } from './lib/inject.mjs';
import { checkCommitted, checkConventions, checkNoSend } from './lib/checks.mjs';
import { WORKFLOWS_DIR } from './build.mjs';

const args = process.argv.slice(2);
const fromIdx = args.indexOf('--from');
const fromFile = fromIdx >= 0 ? args[fromIdx + 1] : null;
const target = args.filter((a, i) => i !== fromIdx && i !== fromIdx + 1).find((a) => !a.startsWith('--'));

/** Workflows to export plus the live name map used to turn IDs back into names. */
async function source() {
  if (fromFile) {
    const parsed = JSON.parse(readFileSync(fromFile, 'utf8'));
    const wf = parsed.workflow || parsed;
    if (!wf?.name || !Array.isArray(wf.nodes)) throw new Error(`${fromFile}: not a workflow object`);
    return { picked: [wf], nameById: new Map([[String(wf.id), wf.name]]), fetch: async (w) => w };
  }
  loadEnv();
  const api = client({ host: process.env.N8N_HOST, apiKey: process.env.N8N_API_KEY });
  const live = await api.listWorkflows();
  const picked = live.filter((w) => /^WF\d+\s/.test(w.name) && (!target || w.name.toUpperCase().startsWith(target.toUpperCase() + ' ')));
  return { picked, nameById: new Map(live.map((w) => [String(w.id), w.name])), fetch: (w) => api.getWorkflow(w.id) };
}

try {
  const { picked, nameById, fetch } = await source();
  if (!picked.length) {
    console.error(`export: nothing matches${target ? ` "${target}"` : ''}`);
    process.exit(1);
  }

  mkdirSync(WORKFLOWS_DIR, { recursive: true });
  let problems = 0;
  for (const w of picked) {
    const full = await fetch(w);
    const clean = stripInjections(resolveForRepo(sanitize(full), nameById));
    const issues = [...checkNoSend(clean), ...checkConventions(clean), ...checkCommitted(clean)];
    const file = fileNameFor(w.name);
    writeFileSync(join(WORKFLOWS_DIR, file), JSON.stringify(clean, null, 2) + '\n');
    console.log(`export: ${w.name} → workflows/${file}${issues.length ? ` (${issues.length} issue(s), review before committing)` : ''}`);
    for (const i of issues) console.log('  - ' + i);
    problems += issues.length;
  }
  if (problems) process.exitCode = 1;
} catch (e) {
  console.error(`export: ${e.message}`);
  process.exit(1);
}
