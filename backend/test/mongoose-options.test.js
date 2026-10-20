// Mongoose 9 logs "the `new` option for `findOneAndUpdate()` and `findOneAndReplace()` is deprecated. Use `returnDocument: 'after'` instead."
// (seen in the live service's log, from the wholesale image registry) and the old spelling is on its way out: a call that kept it would
// one day return the document as it was BEFORE the update. The rest of the code says `returnDocument: 'after'`. This keeps it that way:
// the old spelling is the one code generators reach for first.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

test('no query in src/ uses the deprecated `new` option (use returnDocument)', () => {
  const offenders = [];
  for (const relative of fs.readdirSync(SRC, { recursive: true })) {
    if (!relative.endsWith('.js')) continue;
    fs.readFileSync(path.join(SRC, relative), 'utf8').split('\n').forEach((line, index) => {
      if (/\bnew\s*:\s*(true|false)\b/.test(line)) offenders.push(`backend/src/${relative}:${index + 1}  ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `Mongoose's \`new\` option is deprecated; write returnDocument: 'after' (or 'before'):\n${offenders.join('\n')}`);
});
