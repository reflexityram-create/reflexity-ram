# Address suggestions on the e-Transfer form

The street-address box on `/checkout/e-transfer` can suggest Canadian addresses as the buyer types, and fill the street, city, province and
postal code when one is picked ("Address checked against Canada Post's address data"). Card and bank-debit buyers already get this on Stripe's
page; the e-Transfer form is the shop's own, so it has its own. It is **off until a key is set**, and it can only ever help: with no key, or
if the service is down, slow or out of credit, the box is a plain input and the buyer types the address.

## How it works

```
buyer types  ->  GET /api/address/suggest?q=...[&lastId=...]   ->  Canada Post AddressComplete  Find v2.10      (typing)
buyer picks  ->  GET /api/address/retrieve?id=...              ->  Canada Post AddressComplete  Retrieve v2.11  (a finished address)
```

- The browser never talks to Canada Post and never sees the key: the calls go through our server (`routes/address.js`, `utils/addressLookup.js`),
  so the site's content security policy is unchanged and the paid lookups can be capped.
- A suggestion is `{ id, text, description, next }`. `next: 'find'` is a building or street that opens into its units (`lastId`), `next: 'retrieve'`
  finishes an address. The finished address is `{ line1, line2, city, state, zip }`: only a Canadian address with a province, a valid postal
  code, a street and a city is handed back, so the form never receives something the order would refuse.
- `GET /api/payments/methods` carries `addressSuggest: true` on the e-Transfer entry when a key is set; the page uses the box only then.
- Nothing is stored. Searches are not logged; a provider problem is one log line an hour per reason code (never the request, never the key).
- `components/AddressSuggest.jsx` (keyboard: Down/Up, Enter, Escape, Tab; screen-reader announcements), rules in `lib/addressSuggest.js`.
- The Privacy page says where the typed address goes.

## Turning it on and off (Render environment, service `reflexity-ram`)

| Variable | Meaning |
| --- | --- |
| `ADDRESSCOMPLETE_KEY` | The AddressComplete key, shaped `AA11-AA11-AA11-AA11`. Setting a valid one turns suggestions on; deleting it turns them off. A value of any other shape is ignored. |
| `ADDRESS_LOOKUPS_PER_DAY` | Most finished addresses (paid lookups) the whole site may pick in 24 hours. Default 100, allowed 10 to 2000. |

Change ONE variable with `PUT /v1/services/{id}/env-vars/{KEY}` and then trigger a deploy (the same recipe as the e-Transfer switches).

Limits in `server.js`, mounted before the site-wide limiter so typing never uses up a buyer's general budget: 150 searches per 5 minutes per IP,
20 finished addresses per hour per IP, and the one daily cap above for everyone. Over a limit the page just falls back to typing.

## What it costs (Canada Post price list read on 2026-10-13: confirm on the pricing page)

Credit packs, valid 12 months or until used: **$35 for 300 lookups (11.6 c each)**, $100 for 1,000, $240 for 2,500, $450 for 5,000. A free trial
of 14 days at 100 lookups a day exists. The page does not define a "lookup"; the provider's error 14 ("too many Finds without the corresponding
number of Retrieves") suggests typing is free as long as it ends in a pick, which is how this code is built (one Retrieve per finished address).
Check the first week's usage against that before relying on it. The shop takes a handful of e-Transfer orders, so 300 lookups should last long.

## Getting a key

Register at `https://www.canadapost-postescanada.ca/pca/register/` (company, address, email, password; commercial use only), create an API key
in the account, and put it in `ADDRESSCOMPLETE_KEY`. Leave the key unrestricted by website: the calls come from the server, not a browser.

## Checked, and not yet checked

- Checked: every rule above with a faked provider (`backend/test/address-lookup.test.js`, `frontend/test/address-suggest.test.js`) and in a real
  browser against a stand-in for the service (`walk-address-suggest.cjs` and `walk-review-followups.cjs`, kept in the owner's project notes, not in
  this repository: suggestions while typing, click and keyboard picks, a building opening into its units, one lookup per finished address,
  "checked" removed by editing, a slow answer after tabbing away not reopening the list, a pick surviving the tap on the next field, a failing
  pick showing the manual-entry note, soft failure and an order still placed by typing). The unit tests cannot see the component's inner
  behaviour (a mutation run left five such edits unnoticed), so re-run those walks after touching `AddressSuggest.jsx`.
- Checked against the real service on 2026-10-13 WITHOUT a key (the documentation's sample key `AA11-AA11-AA11-AA11`): `Find/v2.10/json3.ws` and
  `Retrieve/v2.11/json3.ws` exist and answer HTTP 200 JSON, and an error is exactly `{"Items":[{"Error":"2","Description":"Unknown key",...}]}`,
  the shape `utils/addressLookup.js` reads (`provider_2`).
- **Not yet checked: real result rows.** The field names of a found address (`Id`, `Text`, `Description`, `Next`; for a retrieved one `Line1`,
  `City`, `Province`, `PostalCode`, `Language`, ...) follow Canada Post's published field lists, but no row has been seen without a key. The first thing
  to do with a real key is `GET /api/address/suggest?q=100%20queen` and one `retrieve`, and read the rows; fix `utils/addressLookup.js` if a field
  name differs. Do this before relying on it.

## Changing provider

Everything provider-specific is in `utils/addressLookup.js` (and the switch in `utils/addressConfig.js`). The page only knows the two shapes above.
