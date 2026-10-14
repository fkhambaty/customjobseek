# CustomJobSeek complete handoff

> Purpose: make it possible to continue this product from a different laptop
> without reconstructing months of decisions from chat.
>
> Last code audit: 14 October 2026, commit `124be66`.
>
> Never paste secret values into this file. Only secret names and recovery
> procedures belong in git.

## 1. What this product is

CustomJobSeek helps a person:

1. record a factual career profile;
2. define up to six search paths by city/remote and pay;
3. check a pasted job or scan supported employer career boards;
4. receive an honest fit score and blockers;
5. build a resume, application file, and job-description file using only lines
   already present in the profile;
6. track status, follow-ups, people, messages, and history.

It is deliberately not an auto-apply bot. It does not claim to defeat an ATS.
It does not use an LLM in live product flows. The deterministic engine is the
product.

This repository is separate from the private FK Command Center. A one-time seed
script copied the owner's own profile and application history, but the products
do not share code or a database. Recruiter contacts were intentionally not
copied by the first seed.

## 2. Canonical links and ownership

| Item | Value |
|---|---|
| GitHub repository | `https://github.com/fkhambaty/customjobseek` |
| Primary branch | `main` |
| Cloudflare Worker | `customjobseek` |
| Worker URL | `https://customjobseek.fkhambaty.workers.dev` |
| Vercel project | `customjobseek` |
| Vercel URL | `https://customjobseek.vercel.app` |
| D1 database | `customjobseek` |
| Package name | `customjobseek` |

The GitHub repository is the source of truth. Cloudflare owns the API and D1.
Vercel is a frontend mirror with an API rewrite to the Worker.

### Release-transition snapshot (14 October 2026)

This snapshot is historical context, not a substitute for checking production.

- The public Worker was temporarily running hotfix version
  `5183cc53-233e-47a8-97bb-196010e8daeb`.
- That hotfix returned a friendly response for hard D1 quota errors and kept
  the expensive `17 * * * *` hourly job paused.
- Migrations `0014` through `0018` were waiting for the daily D1 write allowance
  to reset at 00:00 UTC.
- The two existing account credit updates were waiting for the same reset.
- Commits through `124be66` had passed TypeScript, all 183 Vitest tests, the
  production build, and a broad local browser E2E pass.
- An unattended release was armed for a few minutes after reset: migrate,
  grant credits, deploy, smoke-test with a disposable account, roll back on a
  failed smoke test, and then push `main` for Vercel.

On a later computer, determine what actually completed instead of assuming:

```bash
git fetch origin
git log --oneline --decorate -10
npx wrangler d1 migrations list customjobseek --remote
npx wrangler deployments list
curl -I https://customjobseek.fkhambaty.workers.dev/
curl -I https://customjobseek.vercel.app/
```

The original machine wrote its unattended release result to
`~/Desktop/customjobseek-release.log`. That local log is not a production
dependency and is intentionally not committed.

## 3. Start on a new laptop

### Install prerequisites

Install:

- Git
- Node.js 24 or a compatible modern LTS release
- npm
- GitHub CLI (`gh`)
- a browser for Cloudflare and GitHub device authorization

Then:

```bash
gh auth login
git clone https://github.com/fkhambaty/customjobseek.git
cd customjobseek
npm ci
npm run typecheck
npm test
npm run build
```

Do not run a production migration or deployment merely to test that the clone
works.

### Local environment

Create `.dev.vars` from `.dev.vars.example`. At minimum, local encrypted profile
work needs a fresh 32-byte key:

```bash
cp .dev.vars.example .dev.vars
openssl rand -base64 32
```

Place that generated value in `.dev.vars` as `DATA_KEY`. This local key is not
the production key and cannot decrypt production data.

Set up local D1 and run:

```bash
npm run db:migrate:local
npm run dev
```

The local scheduled endpoint is:

```text
GET /cdn-cgi/handler/scheduled?cron=* * * * *
```

In local development, missing email configuration logs what would have been
sent. It does not deliver an email.

### Connect production tooling

```bash
npx wrangler login
npx wrangler whoami
gh auth status
```

Production secret values must come from the operator's password manager or
secure secret backup—not from git history, chat, screenshots, or this document.

## 4. Secrets and plain variables

### Cloudflare Worker secrets

| Secret name | Purpose | Consequence if lost |
|---|---|---|
| `DATA_KEY` | AES-GCM encryption for profiles and documents | Existing encrypted data becomes unreadable |
| `RESEND_API_KEY` | Verification, reset, lifecycle mail | Email cannot be delivered |
| `CF_ACCOUNT_ID` | Cloudflare analytics account selector | Proactive quota protection cannot read usage |
| `CF_ANALYTICS_API_TOKEN` | Read-only GraphQL analytics | Same as above |
| `RAZORPAY_KEY_ID` | Razorpay browser checkout identifier | Checkout cannot open |
| `RAZORPAY_KEY_SECRET` | Server-side Razorpay API | Orders cannot be created or verified |
| `RAZORPAY_WEBHOOK_SECRET` | Validates raw webhook signatures | Webhooks cannot grant/refund credits safely |

Set a secret without putting it in shell history:

```bash
npx wrangler secret put SECRET_NAME
```

### Non-secret Worker variables

These live in `wrangler.jsonc`:

- `MAIL_FROM`
- `OWNER_EMAIL`
- `PAYMENTS_ENABLED`

Optional seller variables:

- `LEGAL_NAME`
- `LEGAL_ADDRESS`

Do not invent the legal name or address. Checkout must remain closed until real
seller information exists and Razorpay live activation is complete.

## 5. Normal development workflow

```bash
git switch main
git pull --ff-only
npm ci

# make changes
npm run typecheck
npm test
npm run build

git status
git diff --check
git add <specific files>
GIT_AUTHOR_NAME=fkhambaty \
GIT_AUTHOR_EMAIL=27497411+fkhambaty@users.noreply.github.com \
GIT_COMMITTER_NAME=fkhambaty \
GIT_COMMITTER_EMAIL=27497411+fkhambaty@users.noreply.github.com \
git commit -m "Describe the change"
git push
```

Project-specific rules:

- Imports belong at the top of each module.
- TypeScript switches over unions/enums require an exhaustive `never` default.
- Do not force-push `main`.
- Do not change global git identity to repair one commit.
- Do not commit `.dev.vars`, tokens, private exports, or production database
  dumps.

## 6. Pre-deployment checklist

1. Read `git status` and understand every changed file.
2. Run:

   ```bash
   npm run typecheck
   npm test
   npm run build
   ```

3. Check pending migrations:

   ```bash
   npx wrangler d1 migrations list customjobseek --remote
   ```

4. Read each pending SQL file. Migrations are forward-only.
5. Check Cloudflare D1 usage before any write-heavy operation.
6. Keep `PAYMENTS_ENABLED` false unless intentionally opening checkout.
7. Record the current Worker version so rollback is possible:

   ```bash
   npx wrangler deployments list
   ```

8. Apply migrations before code that depends on them:

   ```bash
   npm run db:migrate:remote
   ```

9. Deploy:

   ```bash
   npm run deploy
   ```

10. Push `main` so the connected Vercel project receives the same frontend.
11. Run the production smoke checklist below.

## 7. Production smoke checklist

Never use a real customer's password or alter a real job during smoke testing.
Use a disposable verified account and delete it after the test.

### Public and authentication

- `/`, `/pricing`, `/companies`, `/support`, and legal pages return 200.
- Signup sends a real verification email.
- A bad verification code is rejected.
- The correct code creates a session.
- Wrong password gives a clear error.
- Sign out lands on the home page.
- A signed-out request to a protected page redirects to login.
- Password reset revokes older sessions.

### Onboarding and profile

- Complete all eight onboarding steps.
- Upload a representative two-column PDF.
- Confirm name/contact, roles, dates, bullets, education, and skills land in
  their proper fields.
- Save and reload the profile.
- Create, edit, reorder, and delete a search path.

### Manual job flow

- Paste a supported job link and read it.
- Paste a full description and run a fit check.
- Confirm one fit credit is spent once.
- Re-open the same job and confirm it is not charged twice.
- Build a resume; confirm one resume credit is spent once.
- Rebuild and confirm it is free.
- Download PDF and verify its first four bytes are `%PDF`.
- Open the HTML and print views.

### Scan and pipeline

- Open the scan review dialog and close it with Escape.
- Start a scan on an account with credits.
- Confirm stages advance and at most three packs are created.
- Confirm the scan-run wallet is charged only if at least one pack is saved.
- Confirm last-scan KPIs appear on Discover.
- Confirm repeated openings are not duplicated.
- Sort each table in both directions.
- Change job status, save notes/follow-up, add a person, add history, reload, and
  confirm persistence.
- Confirm closed-link checks use the two-strike rule.

### Account and support

- Export account data and parse the file as JSON.
- Save consent/email choices.
- Send support signed in and signed out.
- Delete only the disposable account and confirm all its owned records are gone.

### Mobile

At approximately 390 × 844:

- check every navigation route for page-level horizontal overflow;
- open the job drawer;
- open the scan dialog;
- inspect the capacity banner;
- inspect signup, login, pricing, support, and legal pages.

### Capacity simulation

Return a structured 503 from a local/staging API:

```json
{
  "code": "capacity_paused",
  "reason": "quota_reached",
  "resetAt": "a valid future ISO timestamp",
  "error": "paused"
}
```

Confirm:

- signed-out protected pages show the full pause screen,
- login shows a compact notice,
- an open signed-in page shows the in-app banner,
- reset time is expressed in the browser's time zone.

## 8. Rollback and recovery

### Worker rollback

List versions:

```bash
npx wrangler deployments list
```

Roll back to a known-good version:

```bash
npx wrangler rollback <version-id> -y -m "reason"
```

If the broken release introduced a cron, restore the known-good trigger
configuration from the matching commit and deploy triggers.

### Database migrations

D1 migrations do not automatically roll back with Worker code. Prefer additive,
backward-compatible migrations:

- add nullable/defaulted columns first;
- deploy code that can read old and new shapes;
- backfill in bounded batches;
- only later remove old behavior.

For destructive data repair, export/backup first and use a new reviewed SQL
script. Never edit an applied migration and pretend it did not run.

### Lost encryption key

There is no code-only recovery. If `DATA_KEY` is lost and no secure backup
exists, encrypted profile/document rows cannot be decrypted. Keep an offline,
access-controlled backup of the production key.

### D1 daily quota exhaustion

The daily allowance resets at 00:00 UTC. During exhaustion:

- avoid migrations, backfills, bulk updates, and scans;
- keep the hourly crawler paused if necessary;
- do not repeatedly retry writes;
- leave the friendly capacity response in place;
- resume migrations a few minutes after reset;
- smoke-test after deployment.

## 9. Product behavior and commercial rules

### Current wallets

New free accounts receive:

- 3 fit checks,
- 3 resume credits,
- 1 scan run.

The two pre-existing owner/test accounts have a deliberate unlimited-credit
exception in production operations. The UI treats very large wallet values as
“Unlimited.”

Paid plan prices and grants live in `shared/plans.ts`. Purchased credits expire
after 180 days. A run is one manual scan or one scheduled scan, and it is charged
only when at least one pack is prepared.

### Checkout status

The Razorpay implementation exists, but checkout is closed while
`PAYMENTS_ENABLED` is false. Opening checkout must wait for:

1. Razorpay live account activation;
2. live API and webhook secrets;
3. real legal seller name and postal address;
4. one controlled purchase and refund test;
5. confirmation that webhook replay, recovery, refund, and wallet behavior are
   correct.

Notify the operator before any purchase that moves real money.

### Search-path semantics

“Search paths” is the public term. Each is:

- one city or Remote,
- above, below, or any pay,
- a currency and pay period.

The system compares the midpoint of a published range. It does not convert
currency. Jobs without pay remain reviewable and are not assigned an invented
salary. Editing or deleting a path asks whether to reclassify or archive
affected jobs; it does not silently delete them.

## 10. Major decisions and why

### One Worker instead of separate backend services

This keeps deployment simple, puts static assets and API under one origin, and
allows secure HttpOnly cookies without cross-origin complexity.

### D1 despite free-tier limits

D1 was selected for low operating cost and Worker integration. Its daily row
limits are now an explicit architectural constraint. The crawler is write-
capped, background work stops at 50%, and free accounts pause at 85% to reserve
the last 15% for paid users.

### Deterministic engine instead of AI

Truthfulness and predictable cost matter more than fluent invention. Every
resume line must trace to user-authored evidence. The engine can be tested
without model drift, network calls, or per-document AI cost.

### Credits are split by action

Fit checks, first resumes, and scan runs have separate wallets because they
consume different work and have different retry/idempotency boundaries.

### Charge only with a durable result

Fit, resume, and scan writes use atomic guards. A user should never lose credit
when the corresponding job, resume, or pack was not durably saved.

### Search paths instead of a global salary/location filter

People often accept different pay for different cities or remote work. Ordered
paths represent those choices without hiding a job under a single global
threshold.

### Expire openings instead of deleting them

History is necessary to detect returns, prevent duplicates, explain scans, and
avoid erasing information after a transient board failure.

### Two-strike pipeline closure

Career pages sometimes fail or show generic text. One weak signal must not
close a real application.

### Checkout closed by default

No card should be charged before legal seller details and payment operations are
real. The secure default is `PAYMENTS_ENABLED=false`.

## 11. Chronology of the build

The repository's durable history begins on 13 October 2026. Some early commits
were duplicated under a second GitHub identity; commit `76b164e` reconciled the
histories without force-pushing `main`.

### Foundation

- Built factual profiles, deterministic fit, truthful tailored resumes, and a
  job status tracker.
- Added worldwide country/city/currency/pay preferences.
- Added user-submitted missed career pages and public board adapters.
- Added encrypted D1 storage, email/password auth, and session cookies.
- Seeded only the owner's own Command Center data.

### Working job-search loop

- Recreated the useful human workflow: Today, Pipeline, Outreach, Analytics,
  Discover, Resumes, and a detail drawer.
- Added statuses, follow-ups, contacts, message drafts, and history.
- Added persistent market scans and up to three ready-to-send packs.
- Fixed two-column PDF parsing so contact/sidebar text no longer becomes job
  history.

### Commercial and integrity foundation

- Added onboarding, consent, support, legal pages, referrals, rate limits,
  orders, entitlements, quota telemetry, and Razorpay integration.
- Added integrity rules for webhook replay, refunds, expiry, plan upgrades,
  scan charging, truncated board reads, pagination, and session revocation.

### Durable documents and pipeline health

- Stored resume HTML and PDF artifacts.
- Added in-app view/print/download.
- Embedded fonts and rejected unsupported text clearly.
- Added accessible sorting.
- Added saved-job URL liveness checks and two-strike closure.

### Personal search paths

- Added up to six ordered city/remote and pay paths.
- Added migration/reclassification behavior for existing jobs.
- Preserved old lane behavior for users who never create paths.

### Scan UX and quota incident

- Added scan review, last-scan KPIs, and duplicate-opening protection.
- A large employer crawl exhausted the D1 write allowance. Approximately 3,500
  openings at many index writes per opening were the main cause—not ordinary
  user scans.
- Added a per-pass opening-write cap.
- Removed the expensive hourly search-index backfill.
- Stopped background work at 50% usage.
- Paused free accounts at 85%, reserving the last 15% for paid users.
- Mapped hard D1 daily-limit errors to a friendly local-time pause.
- Fixed passive page loads that re-finalized old scans and wasted writes.

### Final October 2026 E2E fixes

- Fixed detached `ArrayBuffer` errors that broke uploaded PDFs.
- Fixed inline role/date parsing during resume import.
- Verified real PDF download (`%PDF`), HTML, and print views.
- Verified search paths, profile persistence, account export, support, auth,
  pipeline edits, contacts, history, and mobile layouts.
- Changed sign-out to land on the home page.
- Clarified scan-credit and time-zone copy.

## 12. Production incidents and lessons

| Incident | Cause | Durable lesson |
|---|---|---|
| Duplicate commit histories | Work authored through two identities | Reconcile; do not force-push shared `main` just for attribution |
| Seeded application overwritten | Duplicate source identifier | Make imported IDs collision-safe |
| Resume fields scrambled | PDF extraction followed file order | Reconstruct reading order from coordinates and test real layouts |
| Discover timeout | Candidate query/read set too large | Bound cheap search and expensive deep reads separately |
| Scan prepared no jobs | Broad title alias matched “consultant” incorrectly | Test occupation aliases against real titles |
| SmartRecruiters gaps | List rows lacked descriptions and pagination was limited | Model adapter capabilities; do not equate listing with full read |
| Generic fit error | Public error mapping hid actionable failures | Keep safe messages specific and attach opaque references only to unknown failures |
| D1 exhaustion | Thousands of openings multiplied by index writes | Budget index writes, cap deltas, and stop background work early |
| Upload 500 | PDF parser transferred/detached its input buffer | Give parser a copy when original bytes are still needed |
| Roles missing on import | Heading and date heuristics swallowed inline roles | Keep realistic resume fixtures and regression tests |
| Page view consumed writes | Completed scan was finalized again on mount | Passive reads must be idempotent and write-free |

## 13. Known constraints and technical debt

1. The Worker currently uses Cloudflare free-plan limits.
2. Proactive capacity protection depends on working analytics credentials.
3. The frontend loads at most 4,000 jobs into aggregate views.
4. Resume artifacts must fit D1's per-value limit.
5. Workday and generic career sites do not have the same capability as stronger
   public ATS APIs.
6. SmartRecruiters coverage may not include every page of a large board.
7. Recruitee's public API has a known 2027 deprecation risk noted in migration
   documentation.
8. The browser E2E suite is not yet committed as Playwright tests.
9. D1 does not provide a traditional automatic migration rollback.
10. Checkout is intentionally unavailable.
11. There is no foreign-exchange conversion.
12. Automatic outreach and auto-apply are intentionally absent.

## 14. Recommended next work

Priority order:

1. Commit the proven browser flows as Playwright tests in the repository.
2. Add CI for typecheck, Vitest, build, and Playwright smoke.
3. Upgrade D1 capacity before sustained customer growth.
4. Add a bounded, explicit maintenance command for any old unindexed openings;
   do not silently restore a large hourly backfill.
5. Improve large-board pagination and adapter health reporting.
6. Expand employer coverage only with write-budget measurements.
7. Add database backup/export and encryption-key rotation runbooks.
8. Enable checkout only after the legal/payment checklist is complete.

For rough capacity planning, one user scan is hundreds—not tens of thousands—of
row writes. Ten users each scanning once was estimated at roughly 3–4% of the
free daily write budget. Employer catalog growth is the larger risk because one
opening can fan out into the opening row, indexes, and search-token rows.

## 15. Fast file index for future engineers

| Question | Start here |
|---|---|
| How does the app boot and route? | `src/main.tsx`, `src/App.tsx` |
| How are sessions represented in React? | `src/session.tsx` |
| How does the browser call APIs? | `src/api.ts` |
| How does the Worker dispatch? | `worker/index.ts` |
| What is encrypted? | `worker/crypto.ts`, route storage code |
| How are passwords/sessions handled? | `worker/crypto.ts`, `worker/session.ts`, `worker/routes/auth.ts` |
| How is fit scored? | `shared/engine/fit.ts` |
| How is a resume kept truthful? | `shared/engine/tailor.ts` |
| How are PDFs stored? | `shared/resumePdf.ts`, `worker/resumeArtifacts.ts` |
| How does employer crawling work? | `worker/scan.ts`, `worker/openingsSync.ts` |
| How does a user scan work? | `worker/autoScan.ts`, `worker/discoverMatch.ts` |
| How are credits made atomic? | `worker/jobCharge.ts`, `worker/resumeCharge.ts`, `worker/batchGuard.ts` |
| How do search paths work? | `shared/engine/searchPaths.ts`, `worker/searchPathStore.ts` |
| How are saved links rechecked? | `worker/pipelineLiveness.ts` |
| Where are plan values? | `shared/plans.ts` |
| Where are quota thresholds? | `shared/capacity.ts`, `shared/dbCapacity.ts`, `worker/dbCapacity.ts` |
| How is Razorpay protected? | `worker/razorpay.ts`, `worker/billing.ts`, `worker/routes/billing.ts` |
| What runs on cron? | `worker/index.ts`, `wrangler.jsonc` |
| What is the schema? | `migrations/` |
| How do I operate production? | `docs/operations.md` and this file |

## 16. Documentation maintenance rule

When behavior changes, update in the same pull request:

1. the relevant code and tests;
2. `docs/architecture.md` if structure or data flow changed;
3. this handoff if an operational decision, incident, limit, or setup step
   changed;
4. `docs/operations.md` if deployment, quotas, payments, or retention changed;
5. the README if user-facing capability or quick-start information changed.

Documentation that contradicts code is worse than missing documentation. Verify
numbers against constants and routes before committing.

