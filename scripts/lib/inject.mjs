// Marker-based injection of repo sources into n8n Code nodes.
//
//   // @inject src/capacity.js as capacity
//   // @end-inject
//
// becomes, at build time, a block that defines `capacity` as an object of the
// module's exports. Prompts (`prompts/x.md as PROMPT`) and config
// (`config as CONFIG`) become `const NAME = <json>;`. The glue code around the
// markers stays in the workflow JSON; the logic stays in the repo.
//
// `stripInjections` empties the blocks again so committed workflow JSON never
// carries config values (personal data) or stale copies of the sources.

import { parsePrompt } from './prompts.mjs';

const START = /^([ \t]*)\/\/ @inject (\S+) as ([A-Za-z_$][\w$]*)[ \t]*$/;
const END = /^[ \t]*\/\/ @end-inject[ \t]*$/;

/** Find marker blocks; returns [{start, end, indent, target, name}] (line indexes). */
export function findBlocks(code, where = 'code') {
  const lines = String(code).split('\n');
  const blocks = [];
  let open = null;
  lines.forEach((line, i) => {
    const s = line.match(START);
    if (s) {
      if (open) throw new Error(`${where}: nested @inject at line ${i + 1}`);
      open = { start: i, indent: s[1], target: s[2], name: s[3] };
    } else if (END.test(line)) {
      if (!open) throw new Error(`${where}: @end-inject without @inject at line ${i + 1}`);
      blocks.push({ ...open, end: i });
      open = null;
    }
  });
  if (open) throw new Error(`${where}: unclosed @inject ${open.target}`);
  return blocks;
}

/** Turn an ES module source into an IIFE expression returning its exports. */
export function moduleToIife(source, file) {
  if (/^\s*import\s/m.test(source)) throw new Error(`${file}: src modules injected into n8n must not import anything`);
  if (/^\s*export\s+default\b/m.test(source)) throw new Error(`${file}: use named exports, not export default`);
  if (/^\s*export\s*\{/m.test(source)) throw new Error(`${file}: use inline "export function/const", not export lists`);
  const names = [...source.matchAll(/^\s*export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  if (!names.length) throw new Error(`${file}: no exports found`);
  const body = source.replace(/^(\s*)export\s+(?=(?:async\s+)?(?:function|const|let|class)\b)/gm, '$1');
  return `(() => {\n${body.trim()}\nreturn { ${names.join(', ')} };\n})()`;
}

/**
 * Render the replacement for one target.
 * @param {string} target 'src/x.js' | 'prompts/x.md' | 'config'
 * @param {(path: string) => string} read file reader relative to repo root
 * @param {object} config parsed config object
 */
export function renderTarget(target, name, read, config) {
  if (target === 'config') {
    const { $comment, ...clean } = config;
    return `const ${name} = ${JSON.stringify(clean, null, 2)};`;
  }
  if (/^src\/[\w.-]+\.js$/.test(target)) return `const ${name} = ${moduleToIife(read(target), target)};`;
  if (/^prompts\/[\w.-]+\.md$/.test(target)) return `const ${name} = ${JSON.stringify(parsePrompt(read(target), target), null, 2)};`;
  throw new Error(`Unknown @inject target "${target}" (expected src/*.js, prompts/*.md or config)`);
}

function replaceBlocks(code, where, render) {
  const blocks = findBlocks(code, where);
  if (!blocks.length) return code;
  const lines = String(code).split('\n');
  for (const b of [...blocks].reverse()) {
    const inner = render(b);
    lines.splice(b.start + 1, b.end - b.start - 1, ...(inner === null ? [] : inner.split('\n')));
  }
  return lines.join('\n');
}

/** Inject into every Code node of a workflow. Returns a new workflow object. */
export function injectWorkflow(workflow, read, config) {
  const wf = structuredClone(workflow);
  for (const node of wf.nodes || []) {
    const code = node.parameters?.jsCode;
    if (typeof code !== 'string') continue;
    node.parameters.jsCode = replaceBlocks(code, `${wf.name} / ${node.name}`, (b) => renderTarget(b.target, b.name, read, config));
  }
  return wf;
}

/** Empty every inject block. Returns a new workflow object. */
export function stripInjections(workflow) {
  const wf = structuredClone(workflow);
  for (const node of wf.nodes || []) {
    const code = node.parameters?.jsCode;
    if (typeof code !== 'string') continue;
    node.parameters.jsCode = replaceBlocks(code, `${wf.name} / ${node.name}`, () => null);
  }
  return wf;
}
