import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { PLANS, PLAN_ORDER } from "../shared/plans";
import { shouldCollectQuotas } from "../shared/capacity";
import { processQueuedScans, runDueSchedules } from "./autoScan";
import { HttpError, type AppEnv, type Env } from "./env";
import { indexUnhashedOpenings } from "./openingsSync";
import { collectDailyQuotas } from "./quota";
import { runLifecycleSweep } from "./lifecycle";
import { reconcileReferralRewards } from "./referrals";
import { purgeExpired } from "./rateLimit";
import { account } from "./routes/account";
import { auth } from "./routes/auth";
import { billing, checkout } from "./routes/billing";
import { companies } from "./routes/companies";
import { discover } from "./routes/discover";
import { jobs } from "./routes/jobs";
import { onboardingRoutes } from "./routes/onboarding";
import { profile } from "./routes/profile";
import { resumes } from "./routes/resumes";
import { mailPrefs } from "./routes/mail";
import { support } from "./routes/support";
import { workspace } from "./routes/workspace";
import { publicErrorBody, publicErrorLog } from "./publicError";
import { scanDue } from "./scan";

const app = new Hono<AppEnv>();

app.use("/api/*", secureHeaders());

// Every state-changing call must be JSON. A cross-site form post cannot set this header,
// which, together with SameSite=Lax cookies, closes the CSRF hole without tokens.
app.use("/api/*", async (c, next) => {
  const pdfUpload = c.req.path === "/api/profile/resume-file" && (c.req.header("content-type") ?? "").includes("pdf");
  const webhook = c.req.path === "/api/billing/razorpay/webhook";
  const unsubscribe = c.req.path === "/api/mail/unsubscribe";
  if (!webhook && !unsubscribe && c.req.method !== "GET" && c.req.method !== "HEAD" && !pdfUpload && !c.req.header("content-type")?.includes("application/json")) {
    throw new HttpError(400, "Requests must be JSON.");
  }
  await next();
});

app.route("/api/auth", auth);
app.route("/api/onboarding", onboardingRoutes);
app.route("/api/profile", profile);
app.route("/api/jobs", jobs);
app.route("/api/companies", companies);
app.route("/api/discover", discover);
app.route("/api/resumes", resumes);
app.route("/api/account", account);
app.route("/api/support", support);
app.route("/api/workspace", workspace);
app.route("/api/mail", mailPrefs);
app.route("/api/billing", billing);
app.route("/api/checkout", checkout);

app.get("/api/plans", (c) => c.json(PLAN_ORDER.map((id) => PLANS[id])));

app.all("/api/*", () => {
  throw new HttpError(404, "Not found.");
});

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  const reference = crypto.randomUUID();
  console.error(publicErrorLog({ reference, method: c.req.method, path: c.req.path, err }));
  return c.json(publicErrorBody(reference), 500);
});

type Schedule = "17 * * * *" | "30 * * * *" | "* * * * *";

function knownSchedule(cron: string): Schedule | null {
  if (cron === "17 * * * *" || cron === "30 * * * *" || cron === "* * * * *") return cron;
  return null;
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled: (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    const job = knownSchedule(event.cron);
    if (!job) {
      console.error("Unknown schedule", event.cron);
      return;
    }
    switch (job) {
      case "17 * * * *":
        ctx.waitUntil(scanDue(env));
        ctx.waitUntil(runLifecycleSweep(env).catch((err: unknown) => console.error("lifecycle mail failed", err)));
        ctx.waitUntil(reconcileReferralRewards(env).catch((err: unknown) => console.error("referral reconcile failed", err)));
        ctx.waitUntil(purgeExpired(env.DB).catch((err: unknown) => console.error("cleanup failed", err)));
        ctx.waitUntil(indexUnhashedOpenings(env).catch((err: unknown) => console.error("search index failed", err)));
        if (shouldCollectQuotas(event.cron, new Date(event.scheduledTime))) {
          ctx.waitUntil(collectDailyQuotas(env).catch((err: unknown) => console.error("quota collect failed", err)));
        }
        return;
      case "30 * * * *":
        ctx.waitUntil(runDueSchedules(env));
        return;
      case "* * * * *":
        ctx.waitUntil(processQueuedScans(env));
        return;
      default: {
        const unexpected: never = job;
        console.error("Unknown schedule", unexpected);
      }
    }
  },
};
