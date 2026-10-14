// The shop's public contact address: the footer, the support page, and the Reply-To of the emails that invite a reply.
// It is a mailbox for questions. E-Transfers go to ETRANSFER_RECIPIENT_EMAIL (Autodeposit on): until 2026-10-13 a DIFFERENT address, since
// then this one too. While they differ a buyer about to send money is told plainly which is which; while they are the same that
// sentence would be false, so it is left out (etransferAddressDiffersFromContact).
const SUPPORT_EMAIL = 'reflexityram@gmail.com';

const sameAddress = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// True when e-Transfers are received at a different address than the contact address. Only then may the buyer be told "not
// our contact email": if the owner ever used one address for both, that sentence would be false, so it is left out.
const etransferAddressDiffersFromContact = (recipient) => Boolean(String(recipient ?? '').trim()) && !sameAddress(recipient, SUPPORT_EMAIL);

module.exports = { SUPPORT_EMAIL, etransferAddressDiffersFromContact };
