// When a buyer can expect the parcel, as a date. Google Customer Reviews times its survey email
// from it, so it errs late: an early date means the survey arrives before the parcel does.

const DISPATCH_BUSINESS_DAYS = 3; // "ships in 1–3 business days"
const CANADA_TRANSIT_BUSINESS_DAYS = 6; // "3–6 business days after dispatch"
const ABROAD_TRANSIT_FALLBACK = 15; // used only when the checkout quote's transit days are unknown
const ABROAD_BUFFER_BUSINESS_DAYS = 3; // customs and the last leg abroad run late more often than not
const CANADA_BUFFER_BUSINESS_DAYS = 1; // on top of a transit time Canada Post quoted for a faster service

// `days` weekdays after `from` (Saturdays and Sundays do not count; holidays are ignored).
function addBusinessDays(from, days) {
  const date = new Date(from);
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return date;
}

function estimateDeliveryDate({ placedAt = new Date(), country = 'CA', transitDays } = {}) {
  const inCanada = String(country || 'CA').toUpperCase() === 'CA';
  const quoted = Math.ceil(Number(transitDays));
  const transit = inCanada
    ? (quoted > 0 ? quoted + CANADA_BUFFER_BUSINESS_DAYS : CANADA_TRANSIT_BUSINESS_DAYS)
    : (quoted > 0 ? quoted : ABROAD_TRANSIT_FALLBACK) + ABROAD_BUFFER_BUSINESS_DAYS;
  return addBusinessDays(placedAt, DISPATCH_BUSINESS_DAYS + transit);
}

module.exports = { addBusinessDays, estimateDeliveryDate };
