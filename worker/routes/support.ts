import { Hono } from "hono";
import { isEmail, parseSupportTopic, supportTopicLabel } from "../../shared/commercial";
import { HttpError, type AppEnv } from "../env";
import { notifyOwner } from "../notify";
import { enforceRateLimit, requestIp } from "../rateLimit";
import { currentUser } from "../session";
import { noteProductEvent } from "../usage";

export const support = new Hono<AppEnv>()
  .post("/", async (c) => {
    const ip = requestIp((name) => c.req.header(name));
    await enforceRateLimit(c.env.DB, "support", `ip:${ip}`);
    const user = await currentUser(c);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const topic = parseSupportTopic(body.topic);
    if (!topic) throw new HttpError(400, "Choose what the note is about.");
    const email = user?.email ?? (typeof body.email === "string" ? body.email.trim().toLowerCase() : "");
    if (!isEmail(email)) throw new HttpError(400, "Enter the email we should reply to.");
    await enforceRateLimit(c.env.DB, "support", `email:${email}`);
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
    if (message.length < 20) throw new HttpError(400, "Write a few sentences so we can help.");

    const id = crypto.randomUUID();
    await c.env.DB.prepare("INSERT INTO support_requests (id, user_id, email, topic, message) VALUES (?, ?, ?, ?, ?)")
      .bind(id, user?.id ?? null, email, topic, message)
      .run();
    await noteProductEvent(c.env.DB, user?.id ?? null, "support_request");
    await notifyOwner(c.env, {
      kind: "support_request",
      dedupeKey: `support:${id}`,
      summary: `New support request about ${supportTopicLabel(topic)}. Reference ${id}.`,
    }).catch((err: unknown) => console.error("support alert failed", err));
    return c.json({ id }, 201);
  });
