// Reads the country a label says a module was made in, from the text OCR found in a photo of it.
//
// The country goes on a customs declaration, so only an explicit statement counts as found
// ("Made in Korea", "Origin: VN"). A bare country word is a hint at most (SK hynix prints "KOREA"
// under its logo), and two different countries in one photo are a conflict, never a guess.

const REGION_NAMES = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
const NOT_COUNTRIES = new Set(["ZZ", "EU", "EZ", "UN", "XA", "XB", "QO"]);

// Lowercase, no accents, words separated by single spaces ("Côte d’Ivoire" -> "cote d ivoire").
const fold = (text) =>
  String(text).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// What labels print instead of the display name.
const ALIASES = {
  KR: ["korea", "republic of korea", "korea republic of", "rep of korea"],
  CN: ["prc", "p r c", "peoples republic of china", "people s republic of china", "mainland china"],
  TW: ["republic of china", "r o c", "roc", "chinese taipei"],
  VN: ["viet nam"],
  US: ["usa", "u s a", "united states of america"],
  GB: ["uk", "u k", "england", "great britain"],
  CZ: ["czech republic"],
  MM: ["burma"],
  HK: ["hong kong"],
  MO: ["macau", "macao"],
  TR: ["turkey"],
  RU: ["russia"],
};

const CODE_TO_NAME = new Map();
const NAME_TO_CODE = new Map();
for (const a of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
  for (const b of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const code = a + b;
    if (NOT_COUNTRIES.has(code)) continue;
    const name = REGION_NAMES.of(code);
    if (!name || name === code) continue;
    CODE_TO_NAME.set(code, name);
    NAME_TO_CODE.set(fold(name), code);
  }
}
for (const [code, names] of Object.entries(ALIASES)) for (const name of names) NAME_TO_CODE.set(name, code);

// Longest names first, so "south korea" wins over "korea" and "north korea" is never read as Korea.
const NAMES_LONGEST_FIRST = [...NAME_TO_CODE.keys()].sort((x, y) => y.length - x.length);

export const countryName = (code) => CODE_TO_NAME.get(String(code || "").toUpperCase()) || null;

// "korea m386abk400m2" -> { code: "KR", words: 1 } (the country must open the text).
function countryAtStart(folded) {
  for (const name of NAMES_LONGEST_FIRST) {
    if (folded === name || folded.startsWith(`${name} `)) return { code: NAME_TO_CODE.get(name), words: name.split(" ").length };
  }
  return null;
}

// Words that introduce the origin. "made in" is read loosely because OCR turns "in" into "1n" or "ln".
const CUE = /\b(m[a4]de\s*[il1|]n|manufactured\s+[il1|]n|product\s+of|country\s+of\s+origin|origin)\b[\s:;.\-–—]*([^\n\r]{0,40}(?:\r?\n[^\n\r]{0,40})?)/gi;

// Countries whose name alone, in capitals, is worth pointing out (not enough to fill the field).
const BARE_WORDS = /\b(KOREA|CHINA|TAIWAN|MALAYSIA|SINGAPORE|JAPAN|VIETNAM|THAILAND|PHILIPPINES)\b/g;

export function readMadeIn(text) {
  const strong = new Map(); // code -> evidence
  for (const match of String(text || "").matchAll(CUE)) {
    const cue = match[1].replace(/\s+/g, " ").trim();
    const rest = match[2].replace(/\s+/g, " ").trim();
    let found = null;
    // "Origin: VN" - a two-letter code, only when printed in capitals
    const iso = rest.match(/^([A-Z]{2})(?![A-Za-z])/);
    if (iso && CODE_TO_NAME.has(iso[1])) found = { code: iso[1], shown: iso[1] };
    if (!found) {
      const hit = countryAtStart(fold(rest));
      if (hit) found = { code: hit.code, shown: rest.split(" ").slice(0, hit.words).join(" ") };
    }
    if (found && !strong.has(found.code)) strong.set(found.code, `${cue} ${found.shown}`);
  }
  if (strong.size === 1) {
    const [[code, evidence]] = strong;
    return { status: "found", code, name: countryName(code), evidence };
  }
  if (strong.size > 1) {
    return { status: "conflict", codes: [...strong.keys()], names: [...strong.keys()].map(countryName), evidence: [...strong.values()] };
  }
  const bare = new Map();
  for (const match of String(text || "").matchAll(BARE_WORDS)) {
    const hit = countryAtStart(fold(match[1]));
    if (hit && !bare.has(hit.code)) bare.set(hit.code, match[1]);
  }
  if (bare.size === 1) {
    const [[code, evidence]] = bare;
    return { status: "hint", code, name: countryName(code), evidence };
  }
  return { status: "none" };
}
