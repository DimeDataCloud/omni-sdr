// Small strict validator. Objects reject unknown keys, so a request can't set a column the route
// didn't mean to expose (mass assignment). Every validator returns the clean value or throws badRequest.
import { badRequest } from './errors.mjs';

const fail = (path, message) => { throw badRequest(`${path || 'body'}: ${message}`, { field: path || 'body' }); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const v = {
  string: ({ min = 0, max = 10000, trim = true, pattern } = {}) => (x, p) => {
    if (typeof x !== 'string') fail(p, 'must be a string');
    const s = trim ? x.trim() : x;
    if (s.length < min) fail(p, min === 1 ? 'is required' : `must be at least ${min} characters`);
    if (s.length > max) fail(p, `must be at most ${max} characters`);
    if (pattern && !pattern.test(s)) fail(p, 'has an invalid format');
    return s;
  },
  uuid: () => (x, p) => (typeof x === 'string' && UUID.test(x) ? x.toLowerCase() : fail(p, 'must be an id')),
  email: () => (x, p) => {
    if (typeof x !== 'string' || x.length > 320 || !EMAIL.test(x.trim())) fail(p, 'must be an email address');
    return x.trim().toLowerCase();
  },
  int: ({ min = -Infinity, max = Infinity } = {}) => (x, p) => {
    const n = typeof x === 'string' && /^-?\d+$/.test(x) ? Number(x) : x;
    if (!Number.isInteger(n)) fail(p, 'must be a whole number');
    if (n < min || n > max) fail(p, `must be between ${min} and ${max}`);
    return n;
  },
  bool: () => (x, p) => (typeof x === 'boolean' ? x : fail(p, 'must be true or false')),
  oneOf: (values) => (x, p) => (values.includes(x) ? x : fail(p, `must be one of ${values.join(', ')}`)),
  datetime: () => (x, p) => {
    if (typeof x !== 'string' || Number.isNaN(Date.parse(x))) fail(p, 'must be an ISO date-time');
    return new Date(x).toISOString();
  },
  url: ({ https = true, max = 500 } = {}) => (x, p) => {
    let u;
    try { u = new URL(x); } catch { fail(p, 'must be a URL'); }
    if (https && u.protocol !== 'https:') fail(p, 'must be an https URL');
    if (String(x).length > max) fail(p, `must be at most ${max} characters`);
    return u.toString();
  },
  array: (item, { min = 0, max = 100 } = {}) => (x, p) => {
    if (!Array.isArray(x)) fail(p, 'must be a list');
    if (x.length < min || x.length > max) fail(p, `must have ${min}-${max} items`);
    return x.map((el, i) => item(el, `${p}[${i}]`));
  },
  json: ({ maxBytes = 4000 } = {}) => (x, p) => {
    if (x === null || typeof x !== 'object' || Array.isArray(x)) fail(p, 'must be an object');
    if (JSON.stringify(x).length > maxBytes) fail(p, `must be at most ${maxBytes} bytes`);
    return x;
  },
  optional: (inner) => Object.assign((x, p) => (x === undefined ? undefined : inner(x, p)), { optional: true }),
  nullable: (inner) => (x, p) => (x === null ? null : inner(x, p)),
  object: (shape, { atLeastOne = false } = {}) => (x, p = '') => {
    if (x === null || typeof x !== 'object' || Array.isArray(x)) fail(p, 'must be an object');
    for (const k of Object.keys(x)) if (!(k in shape)) fail(p ? `${p}.${k}` : k, 'is not an accepted field');
    const out = {};
    for (const [k, check] of Object.entries(shape)) {
      const path = p ? `${p}.${k}` : k;
      if (x[k] === undefined) { if (!check.optional) fail(path, 'is required'); continue; }
      out[k] = check(x[k], path);
    }
    if (atLeastOne && Object.keys(out).length === 0) fail(p, 'nothing to change');
    return out;
  },
};

export const parse = (schema, value) => schema(value ?? {}, '');
