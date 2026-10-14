// Review of 2026-10-14: the upload parsers limited file size and count but not text fields, and Busboy allows any number of
// those by default: a request of thousands of small fields was read into memory in full before the route refused it.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { uploadProductImages, uploadWholesaleImageFile } = require('../src/config/cloudinary');

function appFor(parser) {
  const app = express();
  app.post('/upload', (req, res) => parser(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    return res.json({ files: (req.files || (req.file ? [req.file] : [])).length, fields: Object.keys(req.body || {}).length });
  }));
  return app;
}

async function post(app, form) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/upload`, { method: 'POST', body: form });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const png = () => new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' });

for (const [name, parser, field] of [
  ['product images', uploadProductImages.array('images', 5), 'images'],
  ['wholesale image', uploadWholesaleImageFile.single('image'), 'image'],
]) {
  test(`${name}: an image still uploads, and a flood of text fields is refused`, async () => {
    const ok = new FormData();
    ok.append(field, png(), 'stick.png');
    const accepted = await post(appFor(parser), ok);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.files, 1);

    const flood = new FormData();
    for (let i = 0; i < 200; i += 1) flood.append(`f${i}`, 'x'.repeat(100));
    flood.append(field, png(), 'stick.png');
    const refused = await post(appFor(parser), flood);
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /too many (fields|parts)/i);

    const huge = new FormData();
    huge.append('note', 'x'.repeat(64 * 1024));
    huge.append(field, png(), 'stick.png');
    const tooLong = await post(appFor(parser), huge);
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.body.error, /field value too long/i);
  });
}
