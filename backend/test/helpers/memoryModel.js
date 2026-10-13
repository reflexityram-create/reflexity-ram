// A tiny in-memory stand-in for a Mongoose model, for route tests that must run without a database. It supports the
// handful of calls the phone-app and payment routes make: equality filters (ObjectIds compare as strings), null/missing
// matching, $gt $gte $lt $lte $in $ne, $set/$unset/$inc/$push updates, sort + limit, and the usual chain methods.
const mongoose = require('mongoose');

const clone = (value) => {
  if (value instanceof Date || value instanceof mongoose.Types.ObjectId) return value;
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
};
const get = (doc, key) => key.split('.').reduce((value, part) => (value == null ? undefined : value[part]), doc);
const comparable = (value) => (value instanceof Date ? value.getTime() : value instanceof mongoose.Types.ObjectId ? String(value) : value);
const same = (a, b) => comparable(a) === comparable(b) || (a != null && b != null && String(a) === String(b) && typeof a === 'object' && typeof b === 'object');

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, rule]) => {
    if (key === '$or') return rule.some((part) => matches(doc, part));
    if (key === '$and') return rule.every((part) => matches(doc, part));
    const value = get(doc, key);
    if (rule === null) return value === null || value === undefined;
    if (rule && typeof rule === 'object' && !(rule instanceof Date) && !(rule instanceof mongoose.Types.ObjectId)) {
      return Object.entries(rule).every(([op, arg]) => {
        const a = comparable(value);
        const b = comparable(arg);
        if (op === '$gt') return value != null && a > b;
        if (op === '$gte') return value != null && a >= b;
        if (op === '$lt') return value != null && a < b;
        if (op === '$lte') return value != null && a <= b;
        if (op === '$ne') return !same(value, arg);
        if (op === '$in') return arg.some((x) => same(value, x));
        if (op === '$nin') return !arg.some((x) => same(value, x));
        if (op === '$exists') return (value !== undefined) === arg;
        throw new Error(`memoryModel: unsupported operator ${op}`);
      });
    }
    return same(value, rule);
  });
}

function setPath(doc, key, value, remove = false) {
  const parts = key.split('.');
  const last = parts.pop();
  const parent = parts.reduce((node, part) => (node[part] ??= {}), doc);
  if (remove) delete parent[last]; else parent[last] = value;
}

function applyUpdate(doc, update) {
  const operators = Object.keys(update).filter((k) => k.startsWith('$'));
  for (const [key, value] of Object.entries(update.$set || {})) setPath(doc, key, value);
  for (const key of Object.keys(update.$unset || {})) setPath(doc, key, undefined, true);
  for (const [key, value] of Object.entries(update.$inc || {})) setPath(doc, key, (get(doc, key) || 0) + value);
  for (const [key, value] of Object.entries(update.$push || {})) setPath(doc, key, [...(get(doc, key) || []), value]);
  for (const [key, value] of Object.entries(update)) if (!operators.includes(key)) setPath(doc, key, value);
}

const chain = (value) => {
  let result = value;
  const api = {
    sort(spec) {
      if (Array.isArray(result)) {
        const [[field, dir]] = Object.entries(spec);
        result = [...result].sort((x, y) => (comparable(get(x, field)) > comparable(get(y, field)) ? 1 : comparable(get(x, field)) < comparable(get(y, field)) ? -1 : 0) * dir);
      }
      return api;
    },
    limit(n) { if (Array.isArray(result)) result = result.slice(0, n); return api; },
    select() { return api; },
    populate() { return api; },
    lean() { return api; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return api;
};

function memoryModel(initial = []) {
  const docs = initial.map((doc) => ({ _id: new mongoose.Types.ObjectId(), ...clone(doc) }));
  const model = {
    docs,
    create: async (data) => {
      const doc = { _id: new mongoose.Types.ObjectId(), createdAt: new Date(), ...clone(data) };
      docs.push(doc);
      return doc;
    },
    find: (filter) => chain(docs.filter((doc) => matches(doc, filter))),
    findOne: (filter) => chain(docs.find((doc) => matches(doc, filter)) || null),
    findById: (id) => chain(docs.find((doc) => String(doc._id) === String(id)) || null),
    countDocuments: async (filter) => docs.filter((doc) => matches(doc, filter)).length,
    exists: async (filter) => {
      const doc = docs.find((d) => matches(d, filter));
      return doc ? { _id: doc._id } : null;
    },
    updateOne: async (filter, update) => {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      applyUpdate(doc, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    findOneAndUpdate: async (filter, update, options = {}) => {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return null;
      const before = clone(doc);
      applyUpdate(doc, update);
      return options.returnDocument === 'after' || options.new ? doc : before;
    },
  };
  return model;
}

module.exports = { memoryModel, matches, clone };
