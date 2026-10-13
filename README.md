# CustomJobSeek

Paste a job. Get an honest fit decision and a tailored, ATS-friendly resume built only from your verified experience. Then track the application until you hear back.

This is a standalone product. It shares no code, data, or database with the private FK Command Center.

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
| Free | ₹0 | 3 | 1 | — |
| Starter | ₹599 | 10 | 10 | 6 months |
| Growth | ₹999 | 25 | 25 | 6 months |
| Pro | ₹1,999 | 60 | 60 | 6 months |

A fit check spends one check. The first resume for a job spends one resume credit; rebuilding it after profile edits is free. Plans are defined in `shared/plans.ts`. Checkout returns "Payments open soon" until a payment provider is connected.

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

## Deploy to Cloudflare

```bash
npx wrangler login
npx wrangler d1 create customjobseek        # copy the database_id into wrangler.jsonc
npm run db:migrate:remote
openssl rand -base64 32 | npx wrangler secret put DATA_KEY
npm run deploy
```

Keep the `DATA_KEY` value somewhere safe. Losing it makes every stored profile and resume unreadable.

## Not built yet

- Payments (Razorpay) and crediting purchases to accounts.
- Email verification and password reset.
- Rate limiting on sign-in and link reading.
- Automatic job discovery, outreach, and references. These are later stages once people pay for the core pack.
