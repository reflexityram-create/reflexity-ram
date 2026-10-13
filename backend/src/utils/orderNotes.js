// adminNotes is one string, one note per line. Pending-payment orders carry an "AWAITING ..." line that must disappear
// once the money is confirmed, without touching the other notes (which Canada Post service to buy, an oversold item, ...).
const removeNoteLines = (notes, startsWith) => {
  const kept = String(notes || '').split('\n').filter((line) => line && !line.startsWith(startsWith));
  return kept.length ? kept.join('\n') : null;
};

module.exports = { removeNoteLines };
