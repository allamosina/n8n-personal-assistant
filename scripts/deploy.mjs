#!/usr/bin/env node
// Deploy one workflow (or all) to n8n through the public API.
//   npm run deploy -- WF1            build + check + create/update + activate
//   npm run deploy -- all
//   npm run deploy -- WF1 --no-activate
//   npm run deploy -- WF1 --dry-run   show what would happen, call nothing that writes

import { loadEnv } from './lib/env.mjs';
import { client, resolveForInstance, mergeLiveIdentity, shouldActivate, deployOrder } from './lib/n8n.mjs';
import { build } from './build.mjs';
import { runChecks } from './check-no-send.mjs';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const activate = !args.includes('--no-activate');
const dryRun = args.includes('--dry-run');

function fail(msg) {
  console.error(`deploy: ${msg}`);
  process.exit(1);
}

if (!target) fail('usage: npm run deploy -- <WFn|all> [--no-activate] [--dry-run]');

try {
  loadEnv();
  const built = build({ requireLocal: true });
  const { violations } = runChecks();
  if (violations.length) fail(`refusing to deploy, npm run check reports:\n  - ${violations.join('\n  - ')}`);

  const matched =
    target === 'all'
      ? built
      : built.filter((b) => b.file.toUpperCase().startsWith(target.toUpperCase() + '-') || b.workflow.name === target);
  if (!matched.length) fail(`no workflow matches "${target}"`);

  // WF4 first (error workflow), then each workflow after the sub-workflows it calls.
  const selected = deployOrder(matched);

  const api = client({ host: process.env.N8N_HOST, apiKey: process.env.N8N_API_KEY });
  const live = await api.listWorkflows();
  const idByName = new Map(live.map((w) => [w.name, w.id]));

  for (const { workflow } of selected) {
    const resolved = resolveForInstance(workflow, idByName);
    const existingId = idByName.get(workflow.name);
    if (dryRun) {
      console.log(`deploy (dry run): would ${existingId ? 'update ' + existingId : 'create'} "${workflow.name}"${activate && shouldActivate(workflow) ? ' and activate' : ''}`);
      // Pretend it exists so workflows that call it resolve in the rest of the dry run.
      if (!existingId) idByName.set(workflow.name, `(new: ${workflow.name})`);
      continue;
    }
    let id = existingId;
    if (existingId) {
      const current = await api.getWorkflow(existingId);
      await api.updateWorkflow(existingId, mergeLiveIdentity(resolved, current));
      console.log(`deploy: updated "${workflow.name}" (${existingId})`);
    } else {
      const created = await api.createWorkflow(resolved);
      id = created.id;
      idByName.set(workflow.name, id);
      console.log(`deploy: created "${workflow.name}" (${id})`);
    }
    if (activate && shouldActivate(workflow)) {
      try {
        await api.activate(id);
        console.log(`deploy: activated "${workflow.name}"`);
      } catch (e) {
        console.warn(`deploy: could not activate "${workflow.name}" (credentials attached?): ${e.message}`);
      }
    }
  }
} catch (e) {
  console.error(`deploy: ${e.message}`);
  process.exit(1);
}
