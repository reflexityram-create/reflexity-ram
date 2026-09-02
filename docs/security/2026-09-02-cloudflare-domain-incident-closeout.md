# Cloudflare domain incident closeout — 2026-09-02

## Scope

Authorized Reflexity infrastructure review of `reflexityram.com`, Cloudflare
account `Reflexity RAM`, Pages project `reflexity-ram`, canonical GitHub
repository `reflexityram-create/reflexity-ram`, and the exact
`reflexityram@gmail.com` mailbox. No Stripe, customer, order, or catalog state
was in scope or changed.

## Trigger and classification

Cloudflare emailed `[Action required] Add reflexityram.com again to finish
setup`. The notice named a separate account,
`Reflexityram@gmail.com's Account`, whose incomplete zone was removed after
four weeks without nameserver changes.

VERIFIED: the notice did not describe the production zone. The live zone is
active and unpaused under account `Reflexity RAM`; the canonical domain was
serving throughout the review.

## Remediation

1. Restricted the Cloudflare GitHub App from all repositories to only
   `reflexityram-create/reflexity-ram`.
2. Reconnected Pages project `reflexity-ram` to that exact repository and
   retained `main`, `frontend`, `npm ci && npm run build`, and `dist` as the
   production configuration.
3. Reproduced the high-severity build-time Browserslist advisory from the
   pre-fix lockfile, updated only `frontend/package-lock.json`, and proved the
   full audit changed from one high advisory to zero vulnerabilities.
4. Merged pull request `#21` as
   `fbe8a9042ab21b4a94fc9396908822d24d7aed96` after all required checks passed.
5. Moved the three exact incident conversations to Gmail Trash: the duplicate
   zone notice, the two-message GitHub verification thread, and the pull
   request `#21` Pages deployment notification.

## Verification receipts

| Surface | Verified result |
|---|---|
| Cloudflare zone | `df0c36229a1fcfa3a133fbb76071e35b`, active, unpaused |
| Registration | RDAP expiration 2027-05-20; transfer prohibited |
| Nameservers | `bingo.ns.cloudflare.com`, `miguel.ns.cloudflare.com` |
| DNSSEC | Cloudflare active; public DS `2371 13 2` returned by three recursive resolvers and the `.com` authority |
| Pages source | `reflexityram-create/reflexity-ram`, `main`, automatic preview and production deploys enabled |
| Preview | `f1de4f67-66f4-420e-8763-25ff87ed49e9`, deploy success |
| Production | `9a1cf282-8a52-4856-bbdd-76cda9cbbfc5`, deploy success |
| GitHub | Pull request `#21`; three checks successful; merge `fbe8a904...` |
| Dependency gate | 58/58 frontend tests; build success; full audit zero vulnerabilities |
| Canonical bundle | Apex and exact production URL both serve `assets/index-Byedyi2w.js` |
| Public endpoints | Apex, feed, sitemap, and Render health HTTP 200 |
| `www` redirect | HTTP 301 preserving `/shop/server-ram?source=incident-closeout` |
| Mailbox | Three exact conversations present in Trash after deletion |

The Pages dashboard repository-access banner continued to render after the
repair. It is classified as a CONTRADICTED UI WARNING, not an active failure:
fresh preview and production jobs cloned the repository, built the expected
commits, deployed successfully, and the Pages API reads back the intended Git
source. A future failure at `clone_repo` would falsify that classification and
justify reinstalling the GitHub App.

## No-touch and cleanup

- No DNS record, registrar setting, password, API token, Stripe resource,
  customer record, order, product, or catalog item was changed.
- No email was sent.
- The user's dirty `/home/life/reflexity-ram` worktree was preserved.
- Temporary audit worktrees were removed after their commits and verification
  evidence were safely present on GitHub.
