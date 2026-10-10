#!/usr/bin/env node
// Build: workflows/*.json (glue code with empty @inject blocks) -> build/*.json
// (runnable, with src/, prompts/ and config injected). build/ is gitignored
// because it contains config values.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, loadConfig } from './lib/env.mjs';
import { injectWorkflow } from './lib/inject.mjs';

export const WORKFLOWS_DIR = join(ROOT, 'workflows');
export const BUILD_DIR = join(ROOT, 'build');

export function listWorkflowFiles(dir = WORKFLOWS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
}

export function build({ requireLocal = false, quiet = false } = {}) {
  const { config, source } = loadConfig({ requireLocal });
  const read = (p) => readFileSync(join(ROOT, p), 'utf8');
  mkdirSync(BUILD_DIR, { recursive: true });
  const built = [];
  for (const f of listWorkflowFiles()) {
    const wf = JSON.parse(readFileSync(join(WORKFLOWS_DIR, f), 'utf8'));
    const out = injectWorkflow(wf, read, config);
    writeFileSync(join(BUILD_DIR, f), JSON.stringify(out, null, 2) + '\n');
    built.push({ file: f, workflow: out });
  }
  if (!quiet) console.log(`build: ${built.length} workflow(s) → build/ using ${source}`);
  return built;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    build();
  } catch (e) {
    console.error(`build failed: ${e.message}`);
    process.exit(1);
  }
}
