// The shop's contact address (footer, support page). It is a mailbox for questions. It is NOT where Interac e-Transfers go:
// that is a different address, shown only inside the buyer's own order, and a buyer about to send money is told so plainly.
export const SUPPORT_EMAIL = 'reflexityram@gmail.com';

export const sameAddress = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// True when e-Transfers are received somewhere other than the contact address. Only then may the page say "not our contact
// email" (mirrors backend/src/utils/contact.js): if the owner ever used one address for both, the sentence would be false.
export const differsFromContact = (address) => Boolean(String(address ?? '').trim()) && !sameAddress(address, SUPPORT_EMAIL);
