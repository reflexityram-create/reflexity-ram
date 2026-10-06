// Self-test for the /ocr/ headers: a worker started from this file runs under the /ocr/ Content-Security-Policy
// (a worker takes the policy of its own script's response). It answers "wasm ok" when WebAssembly can be compiled
// there, which the OCR engine needs; "wasm blocked: ..." means the site-wide policy is still being applied.
WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])).then(
  () => postMessage("wasm ok"),
  (error) => postMessage(`wasm blocked: ${error.message}`),
);
