// The shop's contact address (footer, support page). It is a mailbox for questions. Interac e-Transfers go to the address in Render's
// ETRANSFER_RECIPIENT_EMAIL: until 2026-10-13 a different one, since then this one too. While they differ the page tells a buyer about to
// send money which is which; while they are the same that sentence would be false, so it is left out.
export const SUPPORT_EMAIL = 'reflexityram@gmail.com';

export const sameAddress = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// True when e-Transfers are received somewhere other than the contact address. Only then may the page say "not our contact
// email" (mirrors backend/src/utils/contact.js): if the owner ever used one address for both, the sentence would be false.
export const differsFromContact = (address) => Boolean(String(address ?? '').trim()) && !sameAddress(address, SUPPORT_EMAIL);
