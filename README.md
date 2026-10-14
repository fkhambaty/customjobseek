# CustomJobSeek

Paste a job. Get an honest fit decision and a tailored, ATS-friendly resume built only from your verified experience. Then track the application until you hear back.

This is a standalone product. It shares no code, data, or database with the private FK Command Center.

## Project documentation

- [Complete handoff](docs/handoff.md): clone-to-production setup, decisions,
  history, incidents, recovery, smoke tests, constraints, and next work.
- [Architecture](docs/architecture.md): rendered system, data, security,
  crawler, scan, document, capacity, and deployment diagrams.
- [Operations](docs/operations.md): secrets, schedules, Razorpay, retention,
  quota mail, and production safeguards.

## What the first version does

1. A user creates a factual career profile: roles, achievement lines, skills, and a **never claim** list of tools they do not have.
2. They set what they will accept: cities, remote, minimum pay (₹ LPA), target titles, and title words to exclude.
3. They paste a job link or description. Greenhouse and Lever links are read through their public APIs. Other sites are read through `JobPosting` structured data, falling back to page text.
4. The fit engine (`shared/engine/fit.ts`) scores the match from 0 to 100. It separates required skills from nice-to-haves, and raises deal-breakers for pay below the floor, the wrong city, excluded title words, a large experience gap, and required skills on the never-claim list.
5. The tailoring engine (`shared/engine/tailor.ts`) builds a resume by **selecting and reordering the user's own lines**. It never paraphrases or invents. A truth check confirms every line traces back to the profile and nothing from the never-claim list appears.
6. The job is tracked with a status, notes, and a follow-up date.

The resume prints to an A4 PDF with real, extractable text, in the same single-column layout as the Command Center resumes.

## Credits and plans

| Plan | Price | Fit checks | Resumes | Validity |
|------|-------|-----------|---------|----------|
| Free | ₹0 | 3 | 3 | — |
| Starter | ₹599 | 10 | 10 | 180 days |
| Growth | ₹999 | 25 | 25 | 180 days |
| Pro | ₹1,999 | 60 | 60 | 180 days |

A fit check spends one check. The first resume for a job spends one resume credit; rebuilding it after profile edits is free. Plans are defined in `shared/plans.ts`. Checkout charges that INR price through Razorpay only when `PAYMENTS_ENABLED` is `true` and the key id, key secret, and webhook secret all validate. Otherwise it stays closed. Setup for test and live mode is in `docs/operations.md`.

## Stack

- One Cloudflare Worker serves the React app (static assets) and the API under `/api/*` (Hono).
- Cloudflare D1 for storage. Profile and resume bodies are AES-GCM encrypted with the `DATA_KEY` secret.
- Email and password accounts (PBKDF2-SHA256), HTTP-only `SameSite=Lax` session cookies, JSON-only mutations.
- Users can delete their account, which removes every row they own.

```
src/        React app (pages, components, styles)
worker/     API: routes, sessions, crypto, job-link reader
shared/     Types, plans, profile validation, fit and tailoring engines
migrations/ D1 schema
tests/      Engine tests (vitest)
```

## Run locally

```bash
npm install
echo "DATA_KEY=$(openssl rand -base64 32)" > .dev.vars
npm run db:migrate:local
npm run dev
```

Then open the URL Vite prints. `npm test` runs the engine tests and `npm run typecheck` runs TypeScript.

Quota alerts, board refresh, and cleanup are described in `docs/operations.md`.

## Deploy to Cloudflare

```bash
npx wrangler login
npx wrangler d1 create customjobseek        # copy the database_id into wrangler.jsonc
npm run db:migrate:remote
openssl rand -base64 32 | npx wrangler secret put DATA_KEY
npm run deploy
```

Keep the `DATA_KEY` value somewhere safe. Losing it makes every stored profile and resume unreadable.

## Worldwide

The profile stores a country, the cities inside it (or any city you type), a currency, and a minimum and maximum in per year, per month, per hour, or lakhs per year. Pay is compared only when the job uses the same currency. A remote role in another country is flagged.

## Companies we scan

Anyone signed in can paste a job link the tool missed. The company's career
page is added to the `companies` table and scanned. Supported public boards are
re-read on a priority and backoff schedule rather than one fixed interval. A
background pass handles at most 20 due companies and stops early when database
capacity must be preserved. Adapter capabilities differ: some sources provide
full descriptions and others only a list. Openings are matched automatically,
but a deep fit check is still bounded and personalized to one user's profile.

## Documents, all from code

Nothing on the live site calls a language model. The fit score, the resume, the application file and the job-description file are produced by `shared/engine`. The resume and the application file only reorder and quote lines the person wrote. A PDF upload is read for its text and turned into a draft the person must save.

## Email

Sign-up, confirmation and password reset go through Resend, same as the other products. The sender is `MAIL_FROM` in `wrangler.jsonc`. `RESEND_API_KEY` is a Worker secret.

## Importing an existing search

`scripts/seed-from-command-center.mjs` copies one person's own profile and job history from a local Command Center into their account. It does not copy recruiter contacts, and it does not write anything back. Set `SITE_URL` to the deployed site so the password-reset email is sent.

## Intentionally unavailable or incomplete

- Checkout remains closed until real seller details and Razorpay live setup are
  verified.
- The product drafts outreach but does not contact people or auto-apply.
- Some career platforms have list-only or incomplete adapters. Current
  capabilities are documented in `docs/architecture.md`.
- The browser E2E scenarios should be promoted into a committed Playwright
  suite; the durable smoke checklist is in `docs/handoff.md`.
