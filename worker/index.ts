import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { PLANS, PLAN_ORDER, RUN_PACKS, type PlanId } from "../shared/plans";
import { HttpError, type AppEnv, type Env } from "./env";
import { auth } from "./routes/auth";
import { companies } from "./routes/companies";
import { discover } from "./routes/discover";
import { jobs } from "./routes/jobs";
import { profile } from "./routes/profile";
import { resumes } from "./routes/resumes";
import { runDueSchedules } from "./autoScan";
import { scanDue } from "./scan";
import { requireUser } from "./session";

const app = new Hono<AppEnv>();

app.use("/api/*", secureHeaders());

// Every state-changing call must be JSON. A cross-site form post cannot set this header,
// which, together with SameSite=Lax cookies, closes the CSRF hole without tokens.
app.use("/api/*", async (c, next) => {
  const pdfUpload = c.req.path === "/api/profile/resume-file" && (c.req.header("content-type") ?? "").includes("pdf");
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && !pdfUpload && !c.req.header("content-type")?.includes("application/json")) {
    throw new HttpError(400, "Requests must be JSON.");
  }
  await next();
});

app.route("/api/auth", auth);
app.route("/api/profile", profile);
app.route("/api/jobs", jobs);
app.route("/api/companies", companies);
app.route("/api/discover", discover);
app.route("/api/resumes", resumes);

app.get("/api/plans", (c) => c.json(PLAN_ORDER.map((id) => PLANS[id])));

app.post("/api/checkout", requireUser, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const runPack = typeof body.runPack === "string" ? RUN_PACKS.find((pack) => pack.id === body.runPack) : undefined;
  const planId = body.plan as PlanId;
  if (!runPack && (!PLANS[planId] || planId === "free")) throw new HttpError(400, "Pick a paid plan.");
  throw new HttpError(501, "Payments open soon. Your free credits are ready to use now.");
});

app.all("/api/*", () => {
  throw new HttpError(404, "Not found.");
});

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "Something went wrong on our side. Please try again." }, 500);
});

type Schedule = "17 * * * *" | "30 * * * *";

function knownSchedule(cron: string): Schedule | null {
  if (cron === "17 * * * *" || cron === "30 * * * *") return cron;
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
        return;
      case "30 * * * *":
        ctx.waitUntil(runDueSchedules(env));
        return;
      default: {
        const unexpected: never = job;
        console.error("Unknown schedule", unexpected);
      }
    }
  },
};
