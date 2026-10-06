// Copies the OCR engine's files from node_modules into public/ocr/ so the admin page serves them from
// our own origin (nothing is fetched from a CDN, and the photo never leaves the machine). Runs before
// `npm run dev` and `npm run build`; the copies are git-ignored, the versions come from the lockfile.
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'ocr');
const packageDir = (name) => dirname(require.resolve(`${name}/package.json`));

// [package, file inside it, name served from /ocr/]. The two cores are the SIMD build (every current
// browser) and the plain one (older Safari); tesseract.js picks by feature detection.
const FILES = [
  ['tesseract.js', 'dist/worker.min.js', 'worker.min.js'],
  ['tesseract.js-core', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['tesseract.js-core', 'tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['@tesseract.js-data/eng', '4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];

await mkdir(out, { recursive: true });
for (const [pkg, file, name] of FILES) {
  const from = join(packageDir(pkg), file);
  const to = join(out, name);
  await copyFile(from, to);
  const { size } = await stat(to);
  console.log(`ocr: ${name} (${(size / 1024 / 1024).toFixed(1)} MB) from ${pkg}`);
}
