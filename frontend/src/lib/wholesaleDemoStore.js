import { WHOLESALE_DEMO_SEED } from "../data/wholesaleDemoLots.js";
import { publishedWholesaleLots } from "./wholesaleLots.js";

export const WHOLESALE_DEMO_STORAGE_KEY = "reflexity.wholesale-lots.local.v1";
export const WHOLESALE_DEMO_EVENT = "reflexity:wholesale-demo-updated";
export const WHOLESALE_DEMO_SCHEMA_VERSION = 1;
const MAX_DEMO_LOTS = 50;

const TEXT_LIMITS = Object.freeze({
  id: 96,
  title: 160,
  brand: 80,
  mpn: 96,
  generation: 24,
  formFactor: 32,
  capacityLabel: 32,
  speedLabel: 32,
  rank: 32,
  condition: 80,
  testStatus: 80,
  warranty: 48,
  shipFrom: 80,
  imageUrl: 500,
  notes: 500,
  postedAt: 32,
  updatedAt: 32,
});

function cleanText(value, key) {
  return String(value ?? "").trim().slice(0, TEXT_LIMITS[key]);
}

function positiveInteger(value, fallback = 1) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? Math.min(number, 100_000) : fallback;
}

function nonNegativeInteger(value, fallback = 0) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 0 ? Math.min(number, 100_000) : fallback;
}

export function sanitizeWholesaleDemoLot(input = {}) {
  return {
    id: cleanText(input.id, "id"),
    isDemo: true,
    status: input.status === "published" ? "published" : "draft",
    visibility: "local-demo",
    title: cleanText(input.title, "title"),
    brand: cleanText(input.brand, "brand"),
    mpn: cleanText(input.mpn, "mpn"),
    generation: cleanText(input.generation, "generation"),
    formFactor: cleanText(input.formFactor, "formFactor"),
    capacityLabel: cleanText(input.capacityLabel, "capacityLabel"),
    speedLabel: cleanText(input.speedLabel, "speedLabel"),
    rank: cleanText(input.rank, "rank"),
    condition: cleanText(input.condition, "condition"),
    testStatus: cleanText(input.testStatus, "testStatus"),
    warranty: cleanText(input.warranty, "warranty"),
    quantityAvailable: nonNegativeInteger(input.quantityAvailable),
    minimumOrderQuantity: positiveInteger(input.minimumOrderQuantity),
    orderIncrement: positiveInteger(input.orderIncrement),
    shipFrom: cleanText(input.shipFrom, "shipFrom"),
    imageUrl: cleanText(input.imageUrl, "imageUrl"),
    notes: cleanText(input.notes, "notes"),
    quoteOnly: true,
    postedAt: cleanText(input.postedAt, "postedAt"),
    updatedAt: cleanText(input.updatedAt, "updatedAt"),
  };
}

export function validateWholesaleDemoLot(input, { forPublish = false } = {}) {
  const lot = sanitizeWholesaleDemoLot(input);
  const errors = [];
  if (!lot.title) errors.push("Customer-facing title is required.");
  if (!lot.mpn) errors.push("MPN or SKU is required.");
  if (!lot.generation || !lot.formFactor || !lot.capacityLabel || !lot.speedLabel) {
    errors.push("Generation, form factor, capacity, and speed are required.");
  }
  if (forPublish && (!lot.condition || !lot.testStatus || !lot.warranty || !lot.shipFrom)) {
    errors.push("Condition, testing, warranty, and ship-from details are required before publishing.");
  }
  if (forPublish && lot.quantityAvailable < lot.minimumOrderQuantity) {
    errors.push("Available quantity must meet or exceed the minimum order quantity.");
  }
  return errors;
}

export function publishedWholesaleDemoLots(lots = []) {
  return publishedWholesaleLots(lots).filter((lot) => (
    lot.isDemo === true
    && lot.visibility === "local-demo"
    && validateWholesaleDemoLot(lot, { forPublish: true }).length === 0
  ));
}

function cloneSeed() {
  return WHOLESALE_DEMO_SEED.map((lot) => ({ ...lot }));
}

function encodeState(lots) {
  return JSON.stringify({
    schemaVersion: WHOLESALE_DEMO_SCHEMA_VERSION,
    lots: lots.slice(0, MAX_DEMO_LOTS).map(sanitizeWholesaleDemoLot),
  });
}

function resolveStorage(storage) {
  if (storage !== undefined) return storage;
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function readWholesaleDemoState(storage) {
  const target = resolveStorage(storage);
  if (!target) return { lots: [], error: "Browser-local storage is unavailable.", seeded: false };
  let raw;
  try {
    raw = target.getItem(WHOLESALE_DEMO_STORAGE_KEY);
  } catch {
    return { lots: [], error: "Browser-local storage is unavailable.", seeded: false };
  }
  if (raw == null) {
    const lots = cloneSeed();
    try {
      target.setItem(WHOLESALE_DEMO_STORAGE_KEY, encodeState(lots));
      return { lots, error: null, seeded: true };
    } catch {
      return { lots, error: "Demo stock could not be saved in this browser.", seeded: true };
    }
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== WHOLESALE_DEMO_SCHEMA_VERSION || !Array.isArray(parsed.lots)) {
      throw new Error("unsupported demo stock schema");
    }
    return { lots: parsed.lots.slice(0, MAX_DEMO_LOTS).map(sanitizeWholesaleDemoLot), error: null, seeded: false };
  } catch {
    return {
      lots: [],
      error: "Local demo stock could not be read. Restore the demo examples to recover.",
      seeded: false,
    };
  }
}

export function writeWholesaleDemoLots(lots, storage) {
  const target = resolveStorage(storage);
  if (!target) throw new Error("Browser-local storage is unavailable.");
  const safeLots = lots.slice(0, MAX_DEMO_LOTS).map(sanitizeWholesaleDemoLot);
  target.setItem(WHOLESALE_DEMO_STORAGE_KEY, encodeState(safeLots));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WHOLESALE_DEMO_EVENT));
  return safeLots;
}

export function mergeWholesaleDemoExamples(lots = []) {
  const examples = cloneSeed();
  const exampleIds = new Set(examples.map((lot) => lot.id));
  const customLots = lots
    .slice(0, MAX_DEMO_LOTS)
    .map(sanitizeWholesaleDemoLot)
    .filter((lot) => lot.id && !exampleIds.has(lot.id));
  if (examples.length + customLots.length > MAX_DEMO_LOTS) {
    throw new Error("Not enough local demo capacity to restore examples without removing custom lots.");
  }
  return [...examples, ...customLots];
}

export function restoreWholesaleDemoExamples(storage) {
  const current = readWholesaleDemoState(storage);
  return writeWholesaleDemoLots(mergeWholesaleDemoExamples(current.lots), storage);
}

export function upsertWholesaleDemoLot(lots, input) {
  const safe = sanitizeWholesaleDemoLot(input);
  const existingIndex = lots.findIndex((lot) => lot.id === safe.id);
  if (existingIndex < 0) return [safe, ...lots];
  return lots.map((lot, index) => (index === existingIndex ? safe : lot));
}

export function removeWholesaleDemoLot(lots, id) {
  return lots.filter((lot) => lot.id !== id);
}
