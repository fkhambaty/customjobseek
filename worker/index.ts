import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { PLANS, PLAN_ORDER, type PlanId } from "../shared/plans";
import { HttpError, type AppEnv } from "./env";
import { auth } from "./routes/auth";
import { jobs } from "./routes/jobs";
import { profile } from "./routes/profile";
import { requireUser } from "./session";

const app = new Hono<AppEnv>();

app.use("/api/*", secureHeaders());

// Every state-changing call must be JSON. A cross-site form post cannot set this header,
// which, together with SameSite=Lax cookies, closes the CSRF hole without tokens.
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && !c.req.header("content-type")?.includes("application/json")) {
    throw new HttpError(400, "Requests must be JSON.");
  }
  await next();
});

app.route("/api/auth", auth);
app.route("/api/profile", profile);
app.route("/api/jobs", jobs);

app.get("/api/plans", (c) => c.json(PLAN_ORDER.map((id) => PLANS[id])));

app.post("/api/checkout", requireUser, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const planId = body.plan as PlanId;
  if (!PLANS[planId] || planId === "free") throw new HttpError(400, "Pick a paid plan.");
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

export default app;
