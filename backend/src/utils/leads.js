const { Resend } = require('resend');
const { escapeHtml } = require('./htmlEscape');

let resend;
const DEFAULT_FROM = process.env.FROM_EMAIL || 'Reflexity RAM <onboarding@resend.dev>';
const DEFAULT_TO = process.env.LEADS_TO_EMAIL || 'reflexityram@gmail.com';
const LEAD_SEND_TIMEOUT_MS = 12_000;

const INTENT_LABELS = {
  buy: 'Buyer inventory request',
  sell: 'Hardware acquisition lead',
  general: 'General wholesale enquiry',
};

const FIELD_LABELS = [
  ['name', 'Name'], ['company', 'Company'], ['email', 'Email'], ['phone', 'Phone'],
  ['sourceType', 'Source type'], ['sourceId', 'Source ID'], ['sourceCode', 'Source code'],
  ['sku', 'SKU'], ['itemTitle', 'Item title'],
  ['productType', 'Product type'], ['manufacturer', 'Manufacturer'],
  ['partNumber', 'Part number'], ['specification', 'Capacity / specification'],
  ['quantity', 'Quantity'], ['condition', 'Condition'], ['location', 'Location'], ['notes', 'Notes'],
];

function leadText(lead) {
  const lines = [`Type: ${INTENT_LABELS[lead.intent] || 'Wholesale enquiry'}`, ''];
  for (const [field, label] of FIELD_LABELS) {
    if (lead[field] !== undefined && lead[field] !== '') lines.push(`${label}: ${lead[field]}`);
  }
  return lines.join('\n');
}

function buildLeadEmail(lead, { from = DEFAULT_FROM, to = DEFAULT_TO } = {}) {
  const rows = FIELD_LABELS
    .filter(([field]) => lead[field] !== undefined && lead[field] !== '')
    .map(([field, label]) => `<tr><th align="left" style="padding:6px 12px 6px 0;vertical-align:top;">${escapeHtml(label)}</th><td style="padding:6px 0;white-space:pre-wrap;">${escapeHtml(lead[field])}</td></tr>`)
    .join('');

  return {
    from,
    to,
    replyTo: lead.email,
    subject: `New Reflexity wholesale lead: ${INTENT_LABELS[lead.intent] || 'enquiry'}`,
    text: leadText(lead),
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;"><h1 style="font-size:20px;">${escapeHtml(INTENT_LABELS[lead.intent] || 'Wholesale enquiry')}</h1><table role="presentation" cellspacing="0" cellpadding="0">${rows}</table></body></html>`,
  };
}

async function sendLeadEmail(lead, {
  send = (message, options) => {
    if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
    return resend.emails.send(message, options);
  },
  from = DEFAULT_FROM,
  to = DEFAULT_TO,
  timeoutMs = LEAD_SEND_TIMEOUT_MS,
} = {}) {
  const idempotencyKey = `reflexity-lead/${lead.requestId}`;
  const { data, error } = await settleLeadSend(
    send(buildLeadEmail(lead, { from, to }), { idempotencyKey }),
    timeoutMs,
  );
  if (error || !data) throw new Error('Lead delivery was not accepted');
  return data;
}

function settleLeadSend(sendPromise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Lead delivery timed out')), timeoutMs);
    Promise.resolve(sendPromise).then(
      (result) => { clearTimeout(timeout); resolve(result); },
      (error) => { clearTimeout(timeout); reject(error); },
    );
  });
}

module.exports = { buildLeadEmail, sendLeadEmail, settleLeadSend, LEAD_SEND_TIMEOUT_MS };
