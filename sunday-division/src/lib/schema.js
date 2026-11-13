'use strict';

/**
 * Minimal JSON-schema validator for the subset used by agent contracts and model output:
 * type (object|array|string|integer|number|boolean|null, or a list), properties, required,
 * additionalProperties:false, items, enum, minimum, maximum, maxLength, maxItems.
 * Returns a list of error strings (empty when valid).
 */
function validate(schema, value, path = '$', errors = []) {
  if (!schema) return errors;
  const types = [].concat(schema.type || []);
  if (types.length && !types.some((t) => is(t, value))) {
    errors.push(`${path}: expected ${types.join('|')}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => validate(schema.items, item, `${path}[${i}]`, errors));
  }
  if (is('object', value)) {
    const props = schema.properties || {};
    for (const key of schema.required || []) if (!(key in value)) errors.push(`${path}.${key}: required`);
    for (const [key, v] of Object.entries(value)) {
      if (props[key]) validate(props[key], v, `${path}.${key}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}.${key}: not allowed`);
    }
  }
  return errors;
}

function is(type, v) {
  switch (type) {
    case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
    case 'array': return Array.isArray(v);
    case 'string': return typeof v === 'string';
    case 'integer': return Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    default: return false;
  }
}

/** Schema-building shorthands. */
const S = {
  obj: (properties, optional = []) => ({
    type: 'object', properties, additionalProperties: false,
    required: Object.keys(properties).filter((k) => !optional.includes(k)),
  }),
  str: (maxLength = 2000) => ({ type: 'string', maxLength }),
  int: (minimum = 0) => ({ type: 'integer', minimum }),
  bool: () => ({ type: 'boolean' }),
  arr: (items, maxItems = 50) => ({ type: 'array', items, maxItems }),
  enum: (values) => ({ type: 'string', enum: values }),
  nullable: (schema) => ({ ...schema, type: [].concat(schema.type, 'null'), ...(schema.enum ? { enum: [...schema.enum, null] } : {}) }),
};

module.exports = { validate, S };
