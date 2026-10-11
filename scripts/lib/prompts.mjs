// Parse prompts/*.md into prompt objects (format documented in prompts/README.md).

const ALLOWED_EFFORT = ['low', 'medium', 'high', 'xhigh', 'max'];

function fencedJson(section, file, name) {
  const m = section.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!m) throw new Error(`${file}: section "${name}" needs a fenced json block`);
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    throw new Error(`${file}: section "${name}" has invalid JSON: ${e.message}`);
  }
}

/**
 * Every object schema must be closed and list all properties as required.
 * Nullable fields use anyOf: the Anthropic structured-output validator rejects
 * `enum` combined with a type array such as ["string", "null"] (seen live,
 * 2026-10-11: "Enum value 'email_reply' does not match declared type").
 */
export function assertStrictSchema(schema, file, path = '$') {
  if (!schema || typeof schema !== 'object') return;
  const types = [].concat(schema.type || []);
  if (Array.isArray(schema.type) && schema.enum) {
    throw new Error(`${file}: ${path} combines enum with a type array; use anyOf: [{ type, enum }, { type: "null" }]`);
  }
  if (Array.isArray(schema.anyOf)) schema.anyOf.forEach((s, i) => assertStrictSchema(s, file, `${path}.anyOf[${i}]`));
  if (types.includes('object')) {
    if (schema.additionalProperties !== false) throw new Error(`${file}: ${path} must set additionalProperties: false`);
    const props = Object.keys(schema.properties || {});
    const req = schema.required || [];
    const missing = props.filter((p) => !req.includes(p));
    if (missing.length) throw new Error(`${file}: ${path} must list all properties in required (missing: ${missing.join(', ')})`);
    for (const p of props) assertStrictSchema(schema.properties[p], file, `${path}.${p}`);
  }
  if (schema.items) assertStrictSchema(schema.items, file, `${path}[]`);
}

/**
 * @param {string} text markdown source
 * @param {string} file name for error messages
 */
export function parsePrompt(text, file = 'prompt') {
  const sections = {};
  const parts = String(text).split(/^## +/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const name = (nl < 0 ? part : part.slice(0, nl)).trim();
    sections[name] = nl < 0 ? '' : part.slice(nl + 1).trim();
  }
  for (const required of ['Settings', 'System', 'User', 'Schema']) {
    if (!(required in sections)) throw new Error(`${file}: missing "## ${required}" section`);
  }
  const settings = fencedJson(sections.Settings, file, 'Settings');
  if (!settings.model_key) throw new Error(`${file}: Settings.model_key is required`);
  if (!ALLOWED_EFFORT.includes(settings.effort)) throw new Error(`${file}: Settings.effort must be one of ${ALLOWED_EFFORT.join(', ')}`);
  if (!(Number.isInteger(settings.max_tokens) && settings.max_tokens >= 256)) throw new Error(`${file}: Settings.max_tokens must be an integer >= 256`);

  const schema = fencedJson(sections.Schema, file, 'Schema');
  assertStrictSchema(schema, file);

  const guidance = {};
  for (const [name, body] of Object.entries(sections)) {
    const g = name.match(/^Guidance:\s*(\S+)$/);
    if (g) guidance[g[1]] = body;
  }

  return {
    model_key: settings.model_key,
    effort: settings.effort,
    max_tokens: settings.max_tokens,
    system: sections.System,
    user: sections.User,
    schema,
    guidance,
  };
}
