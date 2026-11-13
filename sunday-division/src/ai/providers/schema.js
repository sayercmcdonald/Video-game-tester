'use strict';
const { toApiSchema } = require('../../agents/tools');

/**
 * OpenAI strict function schemas require every property to be listed in `required`.
 * Optional properties are therefore sent as required-but-nullable, and the nulls the
 * model returns for them are removed again before the application validates the input
 * against the original schema.
 */
function nullable(p) {
  if (p.anyOf) return p.anyOf.some((b) => b.type === 'null') ? p : { ...p, anyOf: [...p.anyOf, { type: 'null' }] };
  if (p.type === 'null') return p;
  return { anyOf: [p, { type: 'null' }] };
}

function strictify(s) {
  if (!s || typeof s !== 'object') return s;
  if (s.anyOf) return { ...s, anyOf: s.anyOf.map(strictify) };
  const out = { ...s };
  if (out.items) out.items = strictify(out.items);
  if (out.type === 'object' && out.properties) {
    const required = new Set(out.required || []);
    out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => {
      const p = strictify(v);
      return [k, required.has(k) ? p : nullable(p)];
    }));
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  return out;
}

const toOpenAISchema = (schema) => strictify(toApiSchema(schema));

/** Drop nulls the model returned for properties that are optional in the original schema. */
function fromOpenAIArgs(schema, value) {
  if (!schema || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return schema.items ? value.map((v) => fromOpenAIArgs(schema.items, v)) : value;
  if (!schema.properties) return value;
  const required = new Set(schema.required || []);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === null && !required.has(k)) continue;
    out[k] = schema.properties[k] ? fromOpenAIArgs(schema.properties[k], v) : v;
  }
  return out;
}

module.exports = { toOpenAISchema, fromOpenAIArgs };
