// Canadian postal codes as buyers type them. Same rule as the server (backend/src/config/shipping.js):
// D, F, I, O, Q and U never appear, and W and Z only after the first letter.
export const POSTAL_CODE = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/;

// "m5v 2t6" -> "M5V2T6"
export const normalizePostalCode = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const isPostalCode = (value) => POSTAL_CODE.test(normalizePostalCode(value));

// What the field shows while they type: "m5v2t6" -> "M5V 2T6"; anything past six characters is dropped.
export const formatPostalCode = (value) => {
  const code = normalizePostalCode(value).slice(0, 6);
  return code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
};
