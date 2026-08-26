const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const isValidGuestSessionId = (value) => typeof value === 'string' && SESSION_ID_PATTERN.test(value);
const validGuestSessionId = (value) => (isValidGuestSessionId(value) ? value : null);

module.exports = { SESSION_ID_PATTERN, isValidGuestSessionId, validGuestSessionId };
