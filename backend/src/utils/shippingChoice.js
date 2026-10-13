// The buyer paid for a specific Canada Post service (and maybe a signature). The label has to match what was charged, so
// the order says so where the owner makes the label. Plain flat-rate orders need no note. Shared by every payment method.

// Canada Post service codes the checkout can sell, as the owner knows them when making the label (an unknown code is shown as it is).
const SERVICE_NAMES = {
  'DOM.XP': 'Xpresspost',
  'USA.TP': 'Tracked Packet – USA', 'USA.EP': 'Expedited Parcel USA', 'USA.XP': 'Xpresspost USA',
  'INT.TP': 'Tracked Packet – International', 'INT.XP': 'Xpresspost International',
  'INT.IP.AIR': 'International Parcel Air', 'INT.SP.AIR': 'Small Packet International Air',
};

const shippingChoiceNote = (metadata = {}, label) => {
  const service = metadata.canadaPostService;
  const signature = metadata.signature === 'yes';
  if (!signature && (!service || service === 'STANDARD')) return null;
  const extras = [];
  if (service && service !== 'STANDARD') extras.push(`buy ${SERVICE_NAMES[service] || service}`);
  if (signature) extras.push('add the Signature option');
  return `SHIPPING: the buyer paid for "${label}". When you make the label, ${extras.join(' and ')}.`;
};

module.exports = { SERVICE_NAMES, shippingChoiceNote };
