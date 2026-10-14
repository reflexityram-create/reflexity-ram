// What a buyer is told when they are about to send an Interac e-Transfer. Two things the owner asked for (2026-10-13):
//  1. the address that receives e-Transfers is NOT the shop's contact email, and the buyer is told so plainly;
//  2. the order number in the transfer's message is optional, but it helps the shop match the payment.
// The first sentence is only ever printed when it is true (a different address), and the public methods answer says whether it is.
const test = require('node:test');
const assert = require('node:assert/strict');

const sent = [];
const resendPath = require.resolve('resend');
require.cache[resendPath] = {
  id: resendPath, filename: resendPath, loaded: true,
  exports: { Resend: class { constructor() { this.emails = { send: async (message) => { sent.push(message); return { data: { id: 'email_test' }, error: null }; } }; } } },
};
process.env.FRONTEND_URL = 'https://reflexityram.com';
process.env.NODE_ENV ||= 'test';

const { sendPaymentNoticeEmail } = require('../src/utils/email');
const { SUPPORT_EMAIL, etransferAddressDiffersFromContact } = require('../src/utils/contact');
const { publicPaymentMethods } = require('../src/utils/paymentMethods');

const order = (recipientEmail) => ({
  _id: '64b7f0c2a1b2c3d4e5f60719', orderNumber: 'RFX-ET-NOTICE', total: 180.6, items: [],
  etransfer: { recipientEmail, amountDue: 180.6, expiresAt: new Date('2026-10-15T20:00:00Z') },
});
const textOf = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const send = async (kind, recipientEmail) => {
  sent.length = 0;
  await sendPaymentNoticeEmail({ email: 'buyer@example.com', firstName: 'Sam', order: order(recipientEmail), kind });
  return textOf(sent[0].html);
};

test('the contact address is the one in the footer, and it is not an e-Transfer address unless the owner makes it one', () => {
  assert.equal(SUPPORT_EMAIL, 'reflexityram@gmail.com');
  assert.equal(etransferAddressDiffersFromContact('pay@example.com'), true);
  assert.equal(etransferAddressDiffersFromContact(' Pay@Example.com '), true);
  assert.equal(etransferAddressDiffersFromContact('reflexityram@gmail.com'), false);
  assert.equal(etransferAddressDiffersFromContact('  ReflexityRAM@Gmail.com '), false, 'case and spaces do not make it a different address');
  assert.equal(etransferAddressDiffersFromContact(''), false);
  assert.equal(etransferAddressDiffersFromContact(undefined), false);
});

test('the instructions email names the e-Transfer address, says it is not the contact email, and calls the message optional', async () => {
  const text = await send('etransferInstructions', 'pay@example.com');
  assert.match(text, /Send exactly \$180\.60 CAD by Interac e-Transfer to pay@example\.com ?\./);
  assert.match(text, /You can put RFX-ET-NOTICE in the transfer's message: it is optional, but it helps us match your payment\./);
  assert.match(text, /Send the e-Transfer only to pay@example\.com ?\. Our contact email, reflexityram@gmail\.com, is for questions only: please do not send the e-Transfer there\./);
  assert.doesNotMatch(text, /in the message so we can match it/, 'the old wording sounded required');
  assert.match(text, /Only pay the address above/, 'the existing anti-phishing line is kept');
});

test('the reminder says the same: the address, not the contact email, and the message is optional', async () => {
  const text = await send('etransferReminder', 'pay@example.com');
  assert.match(text, /Send exactly \$180\.60 CAD to pay@example\.com before /);
  assert.match(text, /Putting RFX-ET-NOTICE in the message is optional, but it helps us match your payment\./);
  assert.match(text, /please do not send the e-Transfer there/);
  assert.match(text, /Already sent it\? Thank you/);
});

test('if the owner ever receives e-Transfers at the contact address itself, the "not our contact email" sentence is left out', async () => {
  for (const kind of ['etransferInstructions', 'etransferReminder']) {
    const text = await send(kind, 'ReflexityRAM@gmail.com');
    assert.doesNotMatch(text, /please do not send the e-Transfer there/, kind);
    assert.doesNotMatch(text, /is for questions only/, kind);
    assert.doesNotMatch(text, /contact (e-?mail|address)|different (from|address|mailbox)|not our/i, `${kind}: no wording that claims the payee differs from the contact address`);
    assert.match(text, /reflexityram@gmail\.com/i, `${kind}: the payee is named`);
    assert.match(text, /optional, but it helps us match your payment/, `${kind}: the message wording stays`);
  }
});

test('the public methods answer says whether the page may call the address "not our contact email", and never names the address', () => {
  const on = { ETRANSFER_ENABLED: 'true', ETRANSFER_RECIPIENT_EMAIL: 'pay@example.com' };
  const listed = publicPaymentMethods(on).find((m) => m.id === 'etransfer');
  assert.equal(listed.contactDiffers, true);
  assert.ok(!JSON.stringify(publicPaymentMethods(on)).includes('pay@example.com'), 'the answer does not name the address');
  const same = publicPaymentMethods({ ...on, ETRANSFER_RECIPIENT_EMAIL: 'reflexityram@gmail.com' }).find((m) => m.id === 'etransfer');
  assert.equal(same.contactDiffers, false);
});
