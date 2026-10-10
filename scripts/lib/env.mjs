// Tiny .env loader (no dependencies) and config loader. Real environment
// variables win over .env values.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function loadEnv(file = join(ROOT, '.env')) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

/**
 * config.local.json when present; otherwise config.example.json, unless a
 * real config is required (deploy).
 */
export function loadConfig({ requireLocal = false } = {}) {
  const local = join(ROOT, 'config/config.local.json');
  if (existsSync(local)) return { config: JSON.parse(readFileSync(local, 'utf8')), source: 'config/config.local.json' };
  if (requireLocal) throw new Error('config/config.local.json is missing; copy config/config.example.json and fill it in');
  return { config: JSON.parse(readFileSync(join(ROOT, 'config/config.example.json'), 'utf8')), source: 'config/config.example.json' };
}
