import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileNameFor, pickSettings, shouldActivate, resolveForInstance, resolveForRepo, mergeLiveIdentity, sanitize, toApiBody, deployOrder, dependenciesOf } from '../scripts/lib/n8n.mjs';
import { ROOT } from '../scripts/lib/env.mjs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const exec = (value) => ({ name: 'Upsert', type: 'n8n-nodes-base.executeWorkflow', parameters: { workflowId: { __rl: true, mode: 'id', value } } });

test('fileNameFor', () => {
  assert.equal(fileNameFor('WF1 Email Triage'), 'WF1-email-triage.json');
  assert.equal(fileNameFor('WF0 Upsert Item'), 'WF0-upsert-item.json');
  assert.equal(fileNameFor('wf3 Morning Planner & Digest'), 'WF3-morning-planner-digest.json');
  assert.equal(fileNameFor('WF3b Morning Planner (agent)'), 'WF3b-morning-planner-agent.json');
});

test('pickSettings drops keys the API rejects', () => {
  assert.deepEqual(pickSettings({ executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner', binaryMode: 'x', availableInMCP: true }), { executionOrder: 'v1', callerPolicy: 'workflowsFromSameOwner' });
});

test('only real triggers need activation', () => {
  assert.ok(shouldActivate({ nodes: [{ type: 'n8n-nodes-base.gmailTrigger' }] }));
  assert.ok(!shouldActivate({ nodes: [{ type: 'n8n-nodes-base.executeWorkflowTrigger' }] }));
  assert.ok(!shouldActivate({ nodes: [{ type: 'n8n-nodes-base.errorTrigger' }] }));
  assert.ok(!shouldActivate({ nodes: [{ type: 'n8n-nodes-base.scheduleTrigger', disabled: true }] }));
});

test('name references resolve both ways and errorWorkflow points at WF4', () => {
  const ids = new Map([['WF0 Upsert Item', '11'], ['WF4 Error Handler', '44']]);
  const repo = { name: 'WF1 Email Triage', nodes: [exec('name:WF0 Upsert Item')], connections: {}, settings: { executionOrder: 'v1' } };
  const inst = resolveForInstance(repo, ids);
  assert.equal(inst.nodes[0].parameters.workflowId.value, '11');
  assert.equal(inst.settings.errorWorkflow, '44');
  assert.equal(repo.nodes[0].parameters.workflowId.value, 'name:WF0 Upsert Item', 'input not mutated');
  const back = resolveForRepo(inst, new Map([['11', 'WF0 Upsert Item']]));
  assert.equal(back.nodes[0].parameters.workflowId.value, 'name:WF0 Upsert Item');
  assert.equal(back.settings.errorWorkflow, undefined);
  assert.equal(resolveForInstance({ ...repo, name: 'WF4 Error Handler', nodes: [] }, ids).settings.errorWorkflow, undefined);
  assert.throws(() => resolveForInstance({ ...repo, nodes: [exec('name:WF7 Missing')] }, ids), /not deployed yet/);
});

test('redeploy keeps credentials and webhook IDs attached in the UI', () => {
  const repo = { name: 'W', nodes: [{ name: 'Gmail', credentials: { gmailOAuth2: { id: '', name: 'gmailOAuth2' } } }, { name: 'Trigger' }, { name: 'New' }] };
  const live = { nodes: [{ name: 'Gmail', credentials: { gmailOAuth2: { id: '7', name: 'Gmail' } } }, { name: 'Trigger', webhookId: 'wh-1' }] };
  const merged = mergeLiveIdentity(repo, live);
  assert.deepEqual(merged.nodes[0].credentials.gmailOAuth2, { id: '7', name: 'Gmail' });
  assert.equal(merged.nodes[1].webhookId, 'wh-1');
  assert.equal(merged.nodes[2].credentials, undefined);
});

test('sanitize removes instance data; toApiBody sends only accepted fields', () => {
  const live = { id: '9', name: 'W', active: true, versionId: 'v', pinData: { x: 1 }, staticData: { y: 1 }, settings: { executionOrder: 'v1', errorWorkflow: '44' }, nodes: [{ id: 'n1', name: 'T', webhookId: 'wh', credentials: { telegramApi: { id: '3', name: 'My bot' } } }], connections: { T: {} } };
  const s = sanitize(live);
  assert.deepEqual(Object.keys(s).sort(), ['connections', 'name', 'nodes', 'settings']);
  assert.deepEqual(s.nodes[0], { name: 'T', credentials: { telegramApi: { id: '', name: 'telegramApi' } } });
  assert.deepEqual(s.settings, { executionOrder: 'v1' });
  assert.deepEqual(Object.keys(toApiBody(live)).sort(), ['connections', 'name', 'nodes', 'settings']);
});

test('deploy order: WF4 first, then every workflow after the sub-workflows it calls', () => {
  const item = (name, ...deps) => ({ file: name.split(' ')[0] + '.json', workflow: { name, nodes: deps.map((d) => exec('name:' + d)) } });
  const items = [
    item('WF0 Upsert Item'),
    item('WF1 Email Triage', 'WF5 Decide', 'WF0 Upsert Item'),
    item('WF2 Telegram Intake', 'WF5 Decide', 'WF0 Upsert Item'),
    item('WF3 Morning Planner'),
    item('WF4 Error Handler'),
    item('WF5 Decide'),
  ];
  const names = deployOrder(items).map((i) => i.workflow.name.split(' ')[0]);
  assert.deepEqual(names, ['WF4', 'WF0', 'WF5', 'WF1', 'WF2', 'WF3']);
  assert.deepEqual(dependenciesOf(items[1].workflow), ['WF5 Decide', 'WF0 Upsert Item']);
  // A single selected workflow whose dependency is not in the set is still deployable.
  assert.deepEqual(deployOrder([items[1]]).map((i) => i.workflow.name), ['WF1 Email Triage']);
  assert.throws(() => deployOrder([item('WF7 A', 'WF8 B'), item('WF8 B', 'WF7 A')]), /cycle/);
});

test('repo root resolves to a real path', () => {
  assert.ok(existsSync(join(ROOT, 'package.json')));
  assert.ok(!ROOT.includes('%'));
});
