const WHOLESALE_EMAIL = "reflexityram@gmail.com";

export function publishedWholesaleLots(lots = []) {
  return lots.filter((lot) => (
    typeof lot?.id === "string"
    && lot.id.length > 0
    && lot.status === "published"
    && ["local-demo", "public"].includes(lot.visibility)
    && Number(lot.quantityAvailable) > 0
    && Number(lot.quantityAvailable) >= Math.max(
      1,
      Math.floor(Number(lot.minimumOrderQuantity) || 1),
    )
  ));
}

export function normalizeWholesaleQuantity(lot, value) {
  const available = Math.max(0, Math.floor(Number(lot?.quantityAvailable) || 0));
  if (available < 1) return 0;

  const requested = Math.max(1, Math.floor(Number(value) || 1));
  return Math.min(available, requested);
}

export function buildWholesaleEmailUrl(lines = []) {
  const selected = lines
    .filter((line) => line?.lot)
    .map(({ lot, quantity }) => ({
      lot,
      quantity: normalizeWholesaleQuantity(lot, quantity),
    }))
    .filter(({ quantity }) => quantity > 0);

  const url = new URL("https://mail.google.com/mail/");
  url.searchParams.set("view", "cm");
  url.searchParams.set("fs", "1");
  url.searchParams.set("to", WHOLESALE_EMAIL);
  url.searchParams.set(
    "su",
    selected.length
      ? `Wholesale lot request — ${selected.map(({ lot }) => lot.mpn || lot.id).join(", ")}`
      : "Wholesale RAM volume request",
  );

  const requirements = selected.length
    ? selected.flatMap(({ lot, quantity }, index) => [
      `${index + 1}. ${lot.title}`,
      `   Lot ID: ${lot.id}`,
      `   MPN: ${lot.mpn || "Not listed"}`,
      `   Requested quantity: ${quantity}`,
      "   Please confirm what quantity you can accommodate.",
    ])
    : [
      "SKU / part number:",
      "Memory type / specification:",
      "Quantity:",
    ];

  url.searchParams.set("body", [
    "Hi Reflexity,",
    "",
    "I am looking for wholesale memory stock:",
    "",
    ...requirements,
    "",
    "Condition preference:",
    "Destination:",
    "Needed by:",
    "Company:",
    "",
    "Thank you.",
  ].join("\n"));
  return url.toString();
}
