#!/usr/bin/env node
// Safety check: no send operations, Telegram only to the owner, retries on
// external calls, and committed workflow JSON free of instance and personal data.
// Exit code 1 on any violation.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkNoSend, checkConventions, checkCommitted } from './lib/checks.mjs';
import { WORKFLOWS_DIR, BUILD_DIR, listWorkflowFiles } from './build.mjs';

export function runChecks({ includeBuild = true } = {}) {
  const violations = [];
  let count = 0;
  for (const f of listWorkflowFiles(WORKFLOWS_DIR)) {
    const wf = JSON.parse(readFileSync(join(WORKFLOWS_DIR, f), 'utf8'));
    count++;
    violations.push(...checkNoSend(wf), ...checkConventions(wf), ...checkCommitted(wf));
  }
  if (includeBuild && existsSync(BUILD_DIR)) {
    for (const f of listWorkflowFiles(BUILD_DIR)) {
      const wf = JSON.parse(readFileSync(join(BUILD_DIR, f), 'utf8'));
      violations.push(...checkNoSend(wf).map((v) => `build: ${v}`));
    }
  }
  return { count, violations: [...new Set(violations)] };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { count, violations } = runChecks();
  if (violations.length) {
    console.error(`check: ${violations.length} violation(s)`);
    for (const v of violations) console.error('  - ' + v);
    process.exit(1);
  }
  console.log(`check: ${count} workflow(s), no violations`);
}
