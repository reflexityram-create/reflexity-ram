// The shop's public contact address: the footer, the support page, and the Reply-To of the emails that invite a reply.
// It is a mailbox for questions. It is NOT where Interac e-Transfers go (that is ETRANSFER_RECIPIENT_EMAIL, a different
// address with Autodeposit on), so a buyer who is about to send money is told so plainly.
const SUPPORT_EMAIL = 'reflexityram@gmail.com';

const sameAddress = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// True when e-Transfers are received at a different address than the contact address. Only then may the buyer be told "not
// our contact email": if the owner ever used one address for both, that sentence would be false, so it is left out.
const etransferAddressDiffersFromContact = (recipient) => Boolean(String(recipient ?? '').trim()) && !sameAddress(recipient, SUPPORT_EMAIL);

module.exports = { SUPPORT_EMAIL, etransferAddressDiffersFromContact };
