// Reads the "Made in" country from photos of a module's label, in the browser. The OCR engine (Tesseract,
// compiled to WebAssembly) and its English data are served from our own /ocr/ path (copied there at build
// time by scripts/copy-ocr-assets.mjs), so the photo never leaves the machine and nothing is fetched from a CDN.
import { readMadeIn } from "@/lib/madeIn";

const OCR_PATH = "/ocr";
// Phone photos are 12 megapixels; label text reads fine at 2000 px and a bigger image only takes longer.
const MAX_SIDE = 2000;

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // A File is read locally; a URL (an already uploaded photo) needs CORS so the canvas may be read back.
    const objectUrl = typeof source === "string" ? null : URL.createObjectURL(source);
    if (typeof source === "string") image.crossOrigin = "anonymous";
    const done = (fn, value) => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      fn(value);
    };
    image.onload = () => done(resolve, image);
    image.onerror = () => done(reject, new Error("The photo could not be opened"));
    image.src = objectUrl || source;
  });
}

// A File or an image URL -> a PNG whose long side is at most `maxSide`.
export async function labelImageBlob(source, maxSide = MAX_SIDE) {
  const image = await loadImage(source);
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The photo could not be prepared"))), "image/png"),
  );
}

// Reads every photo with one engine and returns the best answer: the first photo that says where it was
// made (or contradicts itself) wins, else the first hint, else "none". `onStatus` gets short progress text.
export async function readLabels(sources, { onStatus } = {}) {
  const { createWorker } = await import("tesseract.js");
  onStatus?.("Starting the reader…");
  const worker = await createWorker("eng", 1, {
    workerPath: `${OCR_PATH}/worker.min.js`,
    corePath: OCR_PATH,
    langPath: OCR_PATH,
    // A blob worker would inherit the page's policy, which has no WebAssembly; the file at /ocr/ has its own.
    workerBlobURL: false,
    cacheMethod: "none",
    logger: (message) => {
      if (message.status === "recognizing text") onStatus?.(`Reading the label… ${Math.round(message.progress * 100)}%`);
    },
  });
  try {
    let hint = null;
    for (const source of sources) {
      const image = await labelImageBlob(source);
      let text = "";
      let answer = { status: "none" };
      // Sparse text suits a label full of small separate lines; one block of text is the second try.
      for (const mode of ["11", "6"]) {
        await worker.setParameters({ tessedit_pageseg_mode: mode });
        const { data } = await worker.recognize(image);
        text += `\n${data.text}`;
        answer = readMadeIn(text);
        if (answer.status === "found" || answer.status === "conflict") return { ...answer, text };
      }
      if (answer.status === "hint" && !hint) hint = { ...answer, text };
    }
    return hint || { status: "none" };
  } finally {
    await worker.terminate();
  }
}
