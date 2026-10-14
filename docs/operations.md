# Operations

This note is for the person who runs CustomJobSeek. It does not contain a resume, a password, or a sign-in code.

For a new-computer setup, production smoke checklist, recovery steps, and the
history behind these safeguards, read [the complete handoff](handoff.md). For
system and data-flow diagrams, read [the architecture](architecture.md). When
Razorpay verification finishes, follow the
[Razorpay go-live runbook](razorpay-go-live.md) without skipping its test,
approval, first-purchase, or rollback steps.

## Before launch: legal name and checkout

**Do not invent a company name or a street address.** The legal pages stay neutral until `LEGAL_NAME` and `LEGAL_ADDRESS` are set to the real operator. Those are optional Worker vars. They are not set in this repository, and the pages do not copy `OWNER_EMAIL` or `MAIL_FROM` into that sentence.

**Leave `PAYMENTS_ENABLED` as `false`.** Checkout stays closed, so the site does not charge a card under a name that was never configured. Turning payments on without the real legal name and address would publish a false seller. This note does not deploy or migrate production.

Set those two only when you have the real words. They are plain vars, like `PAYMENTS_ENABLED`, not secrets. Put them in `wrangler.jsonc` only when you mean to publish them.

## What runs on a schedule

Cloudflare's free plan allows five cron triggers. This worker uses three:

| Cron | What it does |
|------|----------------|
| `17 * * * *` | Refresh due employer boards (20 at a time), delete old rows, fill the search index, and once a day collect quotas |
| `30 * * * *` | Start daily scans that are due for paid accounts |
| `* * * * *` | Continue scans that are waiting in the queue |

The daily quota check does not add a fourth trigger. It rides the `17 * * * *` job, and it runs only when that job fires at 06:00 UTC.

Apply every pending migration before deploying code that depends on it. Check
the remote list first; do not assume a migration shown in this repository is
already in production.

```bash
npm run db:migrate:local
npx wrangler d1 migrations list customjobseek --remote
npm run db:migrate:remote
```

## Secrets and plain settings

Copy `.dev.vars.example` to `.dev.vars` for local work. Production secrets are set with Wrangler, not committed.

| Name | Where | What it is |
|------|--------|------------|
| `DATA_KEY` | secret | Encrypts profiles and resumes |
| `RESEND_API_KEY` | secret | Sends mail and reads Resend usage |
| `CF_ACCOUNT_ID` | secret | Account tag for Cloudflare analytics |
| `CF_ANALYTICS_API_TOKEN` | secret | Token that can read GraphQL analytics. It is not an admin token |
| `RAZORPAY_KEY_ID` | secret | Public checkout identifier returned only when checkout is enabled |
| `RAZORPAY_KEY_SECRET` | secret | Creates and verifies Razorpay orders |
| `RAZORPAY_WEBHOOK_SECRET` | secret | Verifies the raw webhook body |
| `OWNER_EMAIL` | var, `fktiindia@gmail.com` | Inbox for operational notes |
| `MAIL_FROM` | var | The From address on those notes |
| `PAYMENTS_ENABLED` | var, `false` | Checkout stays closed unless this is the string `true` |
| `LEGAL_NAME` | var, unset | Real operator name on the legal pages. Leave unset. Do not invent one |
| `LEGAL_ADDRESS` | var, unset | Real postal address on the legal pages. Leave unset. Do not invent one |

The analytics token only needs permission to read account analytics. Do not put it in the client, in a log line, or in an owner email.

## Razorpay test and live setup

Checkout stays closed until `PAYMENTS_ENABLED` is `true` and all three Razorpay values validate. The price is the number in `shared/plans.ts`, in INR. A profile currency is only a label. It is not converted, and it is not sent to Razorpay.

Do not put the key secret or the webhook secret in git, in the browser, or in an owner email. The key id is public and is the only Razorpay value the browser receives.

### Test mode

1. In the Razorpay dashboard, switch to test mode.
2. From Settings → API keys, copy the test key id (`rzp_test_…`) and the test key secret.
3. From Settings → Webhooks, add `https://<your-host>/api/billing/razorpay/webhook`.
4. Choose a webhook secret you make up. It must be different from the key secret.
5. Subscribe to `payment.captured`, `payment.failed`, `order.paid`, and `refund.processed`.
6. Put the three values in `.dev.vars` for local work, or set them as Worker secrets. Leave `PAYMENTS_ENABLED` as `false` until all three are present.
7. Set `PAYMENTS_ENABLED` to `true` only for the checkout you intend to exercise.
8. Use Razorpay's test cards. A successful domestic card is `4111 1111 1111 1111`, any future expiry, and any CVV. No real money moves.
9. This repository does not call Razorpay unless those settings are on. Do not point test keys at live mode.

Credits appear after the webhook signature matches the raw body, or after the server reads the order back from Razorpay and sees a captured payment for the same amount. Opening `/checkout/return` does not add credits. A valid webhook can still settle a purchase that was already created if checkout is later turned off. It cannot open a new charge.

### Live mode

1. Complete Razorpay activation for live payments.
2. Create live API keys (`rzp_live_…`) and a separate live webhook secret.
3. Point the live webhook at the same path on the production host, with the same four events.
4. Replace the three Worker secrets. Do not reuse the test secret as the live webhook secret.
5. Set `LEGAL_NAME` and `LEGAL_ADDRESS` to the real operator. Do not invent either value.
6. Set `PAYMENTS_ENABLED` to `true` only after that name and address are the real ones.
7. Run one small live purchase you can refund, then confirm the wallet and the refund email. A failed or refunded notice must not add credits.

```bash
printf '%s' 'rzp_test_or_live_key_id' | npx wrangler secret put RAZORPAY_KEY_ID
printf '%s' 'key_secret' | npx wrangler secret put RAZORPAY_KEY_SECRET
printf '%s' 'webhook_secret' | npx wrangler secret put RAZORPAY_WEBHOOK_SECRET
```

`PAYMENTS_ENABLED` is a plain var in `wrangler.jsonc`, not a secret. Change it there and deploy only when you mean to open checkout. This note does not deploy or migrate production.

## How openings are saved

A board refresh compares the list we just read with the rows already stored.

- A new role is inserted.
- A role whose title, place, or link changed is updated.
- A role that left the board is marked expired. It is not deleted.
- A role that comes back is reactivated.
- A role that is the same is left untouched.

`first_seen_at` stays on the first day we saw the role. `provenance` stays if it was already set. The canonical link is replaced only when the new list has one.

How soon we read a board again depends on its priority:

| Priority | Band | Quiet wait |
|----------|------|------------|
| 80 or more | hot | 2 hours |
| 40–79 | warm | 6 hours |
| 10–39 | cool | 12 hours, or the source freshness if that is longer |
| under 10 | cold | 24 hours, or the source freshness if that is longer |

If a refresh finds nothing new, the next wait stretches, up to a week. If a refresh fails, the wait doubles, also up to a week. The stored error is a short status, not a board token.

Discovery looks up normalized title words in `opening_search`. It does not use a
leading `%word%` search. Board refreshes maintain the index for openings they
touch. There is deliberately no unbounded hourly backfill: an earlier backfill
was removed after it consumed too much of the D1 daily write allowance. If old
rows need indexing, implement and run a bounded, observable maintenance command
after checking the day's write budget.

## Job list

`GET /api/jobs` returns pages of 40. Each row omits the description and the private notes. The app follows `nextCursor` until the list is complete, or until 4,000 jobs, so Today, the pipeline, and analytics still see every job inside that cap. An older bare array, or a page that is not `{ jobs, nextCursor }`, is shown as an error. Nothing is deleted. If more than 4,000 jobs are saved, the screen says it is showing the first 4,000. Opening a job still loads the full record from `GET /api/jobs/:id`.

The tailored resume is stored once, in `resumes`. Application and job-description files stay in `packs`. Migration 0010 clears a `packs` resume only when `resumes` already holds the same ciphertext. Readers still accept an older resume pack if that is all that exists.

## What gets deleted

| Rows | When |
|------|------|
| Sessions | When they expire, and any session older than 45 days |
| Email codes | When they expire |
| Rate-limit buckets | After 48 hours |
| Product events | After 180 days |
| Owner alert notes | After 90 days |
| Scan candidates | 14 days after the scan finished, failed, or was left queued |
| Job history events | After 400 days |
| Quota samples | After 120 days |

## Quota mail

Once a day the worker asks Cloudflare's GraphQL analytics for Worker requests, Worker CPU, and D1 rows, requests, and storage. It asks Resend's usage API for mail sent. The exact field names have changed before, so a response that does not match is ignored. Missing numbers are not invented. The owner gets at most one note per day that telemetry could not be read.

Watched free-plan ceilings live in `shared/capacity.ts`:

| Meter | Ceiling |
|-------|---------|
| Worker requests | 100,000 a day |
| Worker CPU | 1,000,000 ms a day (a watch budget, not a bill) |
| D1 requests | 100,000 a day |
| D1 rows read | 5,000,000 a day |
| D1 rows written | 100,000 a day |
| D1 storage | 5 GB |
| Resend | 100 a day and 3,000 a month, unless the usage API reports its own ceiling |

A note goes to `OWNER_EMAIL` when a meter is at least 80 percent used, or when a straight-line forecast seven days out reaches 90 percent. At 90 percent used the subject says the quota is nearly used up. The same meter does not send the same note twice in one day. The note has a percent and a meter name. It does not include the token, the account id, an email address, or a response body.

## Other owner notes

These also go to `OWNER_EMAIL`, with the same scrubbing, and they do not include the person's email or a support message:

- Someone confirmed a new account. One note per day; the count shows how many.
- Someone opened checkout while payments are still closed.
- A later payment hook applied credits, or recorded a failure or a refund. No card number is stored.
- Several employer scans fail in one pass (5 or more, or at least half of a pass of 4 or more).
- A job-board reader fails five times in a row, and a once-a-day reminder if any reader is still failing.
