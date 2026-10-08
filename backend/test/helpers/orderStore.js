const get = (doc, key) => key.split('.').reduce((v, part) => v?.[part], doc);
const equal = (a, b) => a instanceof Date || b instanceof Date ? +a === +b : a === b;
function matches(doc, filter) {
  return Object.entries(filter).every(([key, rule]) => {
    if (key === '$and') return rule.every((part) => matches(doc, part));
    if (key === '$or') return rule.some((part) => matches(doc, part));
    const value = get(doc, key);
    if (rule === null) return value == null;
    if (rule && typeof rule === 'object' && !(rule instanceof Date)) {
      return Object.entries(rule).every(([op, arg]) => {
        if (op === '$exists') return (value !== undefined) === arg;
        if (op === '$in') return arg.some((x) => equal(value, x));
        if (op === '$nin') return !arg.some((x) => equal(value, x));
        if (op === '$lt') return value != null && value < arg;
        if (op === '$gte') return value != null && value >= arg;
        if (op === '$ne') return !equal(value, arg);
        throw new Error(`Unsupported query ${op}`);
      });
    }
    return equal(value, rule);
  });
}
const set = (doc, key, value, remove = false) => {
  const parts = key.split('.');
  const last = parts.pop();
  const parent = parts.reduce((v, part) => (v[part] ||= {}), doc);
  if (remove) delete parent[last]; else parent[last] = value;
};
const apply = (doc, update) => {
  for (const [key, value] of Object.entries(update.$set || {})) set(doc, key, value);
  for (const key of Object.keys(update.$unset || {})) set(doc, key, null, true);
  for (const [key, value] of Object.entries(update.$push || {})) set(doc, key, [...(get(doc, key) || []), value]);
  for (const [key, value] of Object.entries(update)) if (!key.startsWith('$')) set(doc, key, value);
};
const chain = (value) => ({ select() { return this; }, populate() { return this; }, sort() { return this; },
  lean() { return this; }, limit() { return this; }, skip() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
function orderStore(docs) {
  const store = structuredClone(docs);
  const writes = [];
  return {
    store, writes,
    find: (filter) => chain(structuredClone(store.filter((doc) => matches(doc, filter)))),
    findById: (id) => chain(structuredClone(store.find((doc) => doc._id === id) || null)),
    countDocuments: async (filter = {}) => store.filter((doc) => matches(doc, filter)).length,
    updateOne: async (filter, update) => {
      writes.push({ filter, update });
      const doc = store.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      apply(doc, update);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    findOneAndUpdate: (filter, update, options = {}) => {
      writes.push({ filter, update });
      const doc = store.find((d) => matches(d, filter));
      if (!doc) return chain(null);
      const before = structuredClone(doc);
      apply(doc, update);
      return chain(options.returnDocument === 'after' ? structuredClone(doc) : before);
    },
  };
}
module.exports = { orderStore, chain };
