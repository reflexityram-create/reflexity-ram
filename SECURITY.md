# Security and secret handling

## Core rule

Never commit real tokens, passwords, API keys, webhook secrets, database URLs, or private signing secrets to this repository.

The repository should contain only example files such as `.env.example`. Real values belong in the hosting provider's secret/environment-variable dashboard.

## Cloudflare token rule

Do **not** put a Cloudflare API token in frontend code, backend code, `.env`, `.env.example`, README examples, screenshots, or GitHub commits.

Use one of these patterns instead:

1. **Preferred for Cloudflare Pages:** connect the GitHub repo through Cloudflare Pages Git integration. No Cloudflare API token is needed in this repo.
2. **If using GitHub Actions or direct upload:** store the token as a GitHub Actions secret named `CLOUDFLARE_API_TOKEN`. Store the account ID as `CLOUDFLARE_ACCOUNT_ID`.
3. **If using Workers/Pages runtime secrets:** add secrets in Cloudflare dashboard under Workers & Pages → your project → Settings → Variables and Secrets.

Use the smallest possible token scope. For a Pages deploy token, do not give DNS, billing, account-wide admin, or unrelated zone permissions.

The Cloudflare GitHub App follows the same least-privilege rule: its repository
selection must be **Only select repositories** with
`reflexityram-create/reflexity-ram`. A Pages repository-access warning does not
justify granting the app access to unrelated repositories. Verify recovery by
observing a fresh clone/build/deploy of the expected commit.

## Frontend environment variables

Anything prefixed with `VITE_` is public after the site is built. Treat it like it can be viewed by anyone in the browser.

Safe examples:

- `VITE_API_URL`
- `VITE_STRIPE_PUBLISHABLE_KEY`
- analytics measurement IDs

Unsafe examples:

- `VITE_CLOUDFLARE_API_TOKEN`
- `VITE_STRIPE_SECRET_KEY`
- `VITE_MONGODB_URI`
- `VITE_JWT_SECRET`
- `VITE_RESEND_API_KEY`

## If a secret was ever committed

Deleting the line is not enough if the repo was pushed. Do this:

1. Revoke or rotate the exposed secret in the provider dashboard.
2. Remove it from the current code.
3. Scrub Git history before making the repo public.
4. Re-run a secret scan.

## Local pre-push check

Run this before handing the repo to anyone or pushing it:

```bash
npm run scan:secrets
```

This is a lightweight guardrail, not a replacement for rotating secrets or GitHub secret scanning.

## Public browser source versus private secrets

Anything delivered to the browser can be viewed by customers through View Source, DevTools, or downloaded JavaScript bundles. Never put private keys, API secrets, database URLs, admin passwords, or Cloudflare API tokens in frontend code or `VITE_*` variables.

Cloudflare Web Analytics may inject a `data-cf-beacon` snippet into deployed HTML when Web Analytics is enabled in Cloudflare. That visible value is a Web Analytics site token used by the browser beacon, not a Cloudflare API token. If you do not want that snippet visible in page source, disable Cloudflare Web Analytics in the Cloudflare dashboard; it is injected by Cloudflare, not by this repo's frontend code.
