// URLSearchParams has already decoded the callback value. Parsing that value
// first preserves legitimate percent characters in names (for example, "100%").
// The second branch supports callbacks issued by an older deploy that encoded
// the JSON payload twice.
export function parseCallbackUser(userRaw) {
  const parseObject = (value) => {
    if (typeof value !== 'string') throw new Error('Invalid callback user');
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid callback user');
    return parsed;
  };

  try {
    return parseObject(userRaw);
  } catch {
    try {
      return parseObject(decodeURIComponent(userRaw));
    } catch {
      return null;
    }
  }
}
