# Address suggestions on the e-Transfer form

The street-address box on `/checkout/e-transfer` can suggest Canadian addresses as the buyer types. Card and bank-debit buyers already get this
on Stripe's page; the e-Transfer form is the shop's own, so it has its own. Two providers, one at a time:

- **Canada Post AddressComplete** (paid, needs a key): picking fills the street, city, province AND postal code, and the box says
  "Address checked against Canada Post's address data".
- **Photon** (free, open source, OpenStreetMap data; see "The free provider" below): picking fills the street, city and province only. The
  buyer types the postal code; the box never claims a check.

It is **off until one is switched on**, and it can only ever help: if the service is off, down, slow or out of credit, the box is a plain
input and the buyer types the address.

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
| `ADDRESSCOMPLETE_KEY` | The AddressComplete key, shaped `AA11-AA11-AA11-AA11`. Setting a valid one turns Canada Post suggestions on (it wins over Photon); deleting it turns them off. A value of any other shape is ignored. |
| `ADDRESS_SUGGEST_PHOTON` | `true` turns the free provider on (only used while no valid Canada Post key is set); deleting it turns it off. |
| `ADDRESS_LOOKUPS_PER_DAY` | Most finished addresses (picks) the whole site may make in 24 hours, with either provider. Default 100, allowed 10 to 2000. |
| `PHOTON_SEARCHES_PER_DAY` | Most searches the whole site may send to Photon in 24 hours. Default 3000, allowed 100 to 20000. Only counts while Photon is the provider. |

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
- **Free provider (Photon), checked 2026-10-14:** the rules with recorded REAL Photon answers (`backend/test/address-photon.test.js`, answers
  in `backend/test/fixtures/photon-*.json`: switch, address shaping, US results dropped, no request before a house number, every failure
  soft, timeout, remembered picks expiring, the routes' shape) and the page rules (`frontend/test/address-suggest.test.js`). In a real
  browser against the REAL public Photon server (`walk-address-photon.cjs` in the owner's project notes; 29/29 desktop, 28/28 phone):
  no search before a house number; one search per pause in typing; Canadian suggestions only; the credit under the list, linked, still
  there after a slow click and followed by a tap on a phone; a pick fills street, city and province but never the postal code, says
  "filled in from OpenStreetMap" and moves the cursor to the postal code; the postal-area and province notes; editing removes the note
  and a second pick keeps the typed postal code; the order saved in the database carries exactly that address; a server restart between
  typing and picking gives "We could not fill in that address just now. Please type it below."
- Not checked in a browser for the free provider: Photon down or slow (covered by the unit tests above; the page's handling of
  "unavailable" is the same code the Canada Post walk proved).
- **Not yet checked: real result rows.** The field names of a found address (`Id`, `Text`, `Description`, `Next`; for a retrieved one `Line1`,
  `City`, `Province`, `PostalCode`, `Language`, ...) follow Canada Post's published field lists, but no row has been seen without a key. The first thing
  to do with a real key is `GET /api/address/suggest?q=100%20queen` and one `retrieve`, and read the rows; fix `utils/addressLookup.js` if a field
  name differs. Do this before relying on it.

## The free provider: Photon (OpenStreetMap)

[Photon](https://github.com/komoot/photon) is an open-source geocoder by Komoot that searches OpenStreetMap's data. We call the public server
`https://photon.komoot.io/api/` from our server. It needs no key and no account, and it is free for moderate use: its README says heavy users
may be throttled or blocked, and that availability is not guaranteed. That is why the whole site has one daily cap
(`PHOTON_SEARCHES_PER_DAY`). Each request names the shop in its User-Agent, asks only for houses (`layer=house`) inside Canada's box
(`bbox`), and keeps only results whose country is CA.

**Measured on the real server, 2026-10-13/14** (scripts and saved answers in the owner's project notes):

- 50 ordinary Toronto addresses drawn at random from the City of Toronto's open Address Points file (525,369 points): **48 found at
  house-number level (96%)**; `36 Rodeo Ptwy` and `6 Moore Ave` were not. Median answer 1.2 s. These postal codes were not checked: the
  City's file has none.
- 20 well-known addresses across Canada: 18 found at house-number level. Only **10 of the 18 had the exact postal code**: 7 others were
  right in the first three characters only, and one (2 Wellington St W, Brampton) was in another postal area (L6W instead of L6Y).
- Partial typing works once a number and part of the street are in (`100 queen` gives 100 Queen St W Toronto, 100 Queen St Ottawa, ...);
  `16 belg` gives nothing useful until more is typed.

So, by design:

- **The postal code is never filled in from OpenStreetMap.** A picked address arrives with `zip: ''` and, when OpenStreetMap had one,
  `zipHint` = its first three characters (the postal area). The form uses the hint only for a note that says it can be ignored:
  "Check your postal code: this street is usually in area L6W, and yours starts with L6Y. If yours is right, you can ignore this."
- The province is selected from the first letter of a complete postal code when the buyer has not chosen one, and a note shows when the
  two disagree (exact: the first letter names the province; X is the Northwest Territories or Nunavut).
- Under the list: "Suggestions © OpenStreetMap contributors" linked to `https://www.openstreetmap.org/copyright`. OpenStreetMap's licence
  (ODbL) asks for that credit next to the results, without a click. After a pick: "Street, city and province filled in from OpenStreetMap.
  Please check them and type your postal code." Nothing says "checked".
- Typing waits for a digit (the house layer has nothing to offer before a number), so no request is spent on "Que...".
- A suggestion is kept on the server for 15 minutes (at most 500 at once, in memory), so a pick needs no second call to Photon and carries
  nothing from the browser but its id. A pick after 15 minutes, or after a deploy restarted the server, says "We could not fill in that
  address just now. Please type it below." This assumes ONE server instance (Render's plan today); with several, a pick could land on an
  instance that never saw the suggestion and get that note.
- The Privacy page names both providers and says only the typed text is sent.

To run our own Photon instead of the public one (if the shop outgrows "moderate use"): Java 21+, about 95 GB of disk for the planet
(a Canada-only build needs less; not measured) and 64 GB of RAM recommended for the planet; point `PHOTON_BASE_URL` at it.

## Changing provider

Everything provider-specific is in `utils/addressLookup.js` (and the switch in `utils/addressConfig.js`). The page only knows the two shapes above.
