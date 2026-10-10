#!/usr/bin/env node
// Export workflows from n8n into workflows/, sanitized for committing:
// instance IDs, credential IDs and webhook IDs removed, sub-workflow references
// turned into "name:<workflow name>", inject blocks emptied.
//   npm run export            all workflows whose name starts with "WF"
//   npm run export -- WF3     one workflow

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from './lib/env.mjs';
import { client, sanitize, resolveForRepo, fileNameFor } from './lib/n8n.mjs';
import { stripInjections } from './lib/inject.mjs';
import { checkCommitted, checkNoSend } from './lib/checks.mjs';
import { WORKFLOWS_DIR } from './build.mjs';

const target = process.argv.slice(2).find((a) => !a.startsWith('--'));

try {
  loadEnv();
  const api = client({ host: process.env.N8N_HOST, apiKey: process.env.N8N_API_KEY });
  const live = await api.listWorkflows();
  const nameById = new Map(live.map((w) => [String(w.id), w.name]));
  const picked = live.filter((w) => /^WF\d+\s/.test(w.name) && (!target || w.name.toUpperCase().startsWith(target.toUpperCase() + ' ')));
  if (!picked.length) {
    console.error(`export: nothing matches${target ? ` "${target}"` : ''}`);
    process.exit(1);
  }

  mkdirSync(WORKFLOWS_DIR, { recursive: true });
  let problems = 0;
  for (const w of picked) {
    const full = await api.getWorkflow(w.id);
    const clean = stripInjections(resolveForRepo(sanitize(full), nameById));
    const issues = [...checkNoSend(clean), ...checkCommitted(clean)];
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
