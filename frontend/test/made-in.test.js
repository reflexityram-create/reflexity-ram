import assert from 'node:assert/strict';
import test from 'node:test';
import { countryName, readMadeIn } from '../src/lib/madeIn.js';

const code = (text) => readMadeIn(text).code;

// Lines Tesseract really produced from the four listing photos (2026-10-05).
test('it reads the real OCR of the listing photos', () => {
  assert.deepEqual(readMadeIn('Manufacturer for Lenovo\nMADE IN VIETNAM (Ai it /t S036)\nUPC'), {
    status: 'found', code: 'VN', name: 'Vietnam', evidence: 'MADE IN VIETNAM',
  });
  assert.deepEqual(readMadeIn('SAMSUNG\nMade in Korea M386ABK400M2 —\nCE'), {
    status: 'found', code: 'KR', name: 'South Korea', evidence: 'Made in Korea',
  });
  // Lenovo's box also prints "(4L)Origin: VN" - the same country twice is still one answer.
  assert.equal(readMadeIn('(4L)Origin: VN\nMADE IN VIETNAM').status, 'found');
  assert.equal(code('(4L)Origin: VN\nMADE IN VIETNAM'), 'VN');
});

test('a bare country word under a logo is a hint, never an answer', () => {
  // SK hynix prints its home country under the logo; the sticks are also built elsewhere.
  assert.deepEqual(readMadeIn('SKhynix\nKOREA\n64GB 4DRx4'), { status: 'hint', code: 'KR', name: 'South Korea', evidence: 'KOREA' });
  assert.equal(readMadeIn('Korea and China').status, 'none', 'lower-case prose is not a label');
  assert.equal(readMadeIn('KOREA ... CHINA').status, 'none', 'two bare countries say nothing');
});

test('"Manufacturer", "made in" without a country and ordinary words say nothing', () => {
  for (const text of ['Manufacturer for Lenovo', 'Made in 2022-09', 'made in a clean room', 'Date: 2022-09-13', '', undefined, null]) {
    assert.equal(readMadeIn(text).status, 'none', String(text));
  }
});

test('it tolerates what OCR does to "made in" and to the country', () => {
  assert.equal(code('Madein Korea'), 'KR');
  assert.equal(code('MADE 1N CHINA'), 'CN');
  assert.equal(code('Made ln Malaysia'), 'MY');
  assert.equal(code('MADE IN\nKOREA'), 'KR', 'country on the next line');
  assert.equal(code('Made In P.R.C.'), 'CN');
  assert.equal(code('Made in Taiwan, R.O.C.'), 'TW');
  assert.equal(code('Made in Republic of Korea'), 'KR');
  assert.equal(code('Made in Viet Nam'), 'VN');
  assert.equal(code('MADE IN USA'), 'US');
  assert.equal(code('Product of Philippines'), 'PH');
  assert.equal(code('Manufactured in Singapore'), 'SG');
  assert.equal(code('Country of Origin: Japan'), 'JP');
  assert.equal(code('Made in Germany'), 'DE');
  assert.equal(code('Made in Hong Kong'), 'HK');
  assert.equal(code('Made in Türkiye'), 'TR');
});

test('a two-letter origin code counts only in capitals', () => {
  assert.equal(code('Origin: KR'), 'KR');
  assert.equal(code('Origin: CN/MY'), 'CN');
  assert.equal(readMadeIn('origin: kr').status, 'none');
  assert.equal(readMadeIn('Origin: ZZ').status, 'none', 'not a country');
});

test('two different countries are a conflict to settle by looking at the stick', () => {
  const result = readMadeIn('Made in Korea\n...\nMade in China');
  assert.equal(result.status, 'conflict');
  assert.deepEqual(result.codes, ['KR', 'CN']);
  assert.deepEqual(result.names, ['South Korea', 'China']);
});

test('North Korea is not mistaken for Korea', () => {
  assert.equal(code('Made in North Korea'), 'KP');
  assert.equal(code('Made in South Korea'), 'KR');
});

test('country names come from the standard region list', () => {
  assert.equal(countryName('kr'), 'South Korea');
  assert.equal(countryName('VN'), 'Vietnam');
  assert.equal(countryName('ZZ'), null);
  assert.equal(countryName(''), null);
});
