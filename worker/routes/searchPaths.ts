import { Hono } from "hono";
import { parsePathCommit, type PathCommit } from "../../shared/engine/searchPaths";
import { HttpError, type AppEnv } from "../env";
import { requireUser } from "../session";
import { commitSearchPaths, listSearchPaths, previewSearchPaths } from "../searchPathStore";
import { loadProfile } from "./profile";

function readCommit(body: unknown, extra?: Record<string, unknown>): PathCommit {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const parsed = parsePathCommit({ ...record, ...extra });
  if (!parsed.ok) throw new HttpError(400, parsed.error);
  return parsed.commit;
}

export const searchPathRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .get("/", async (c) => {
    const paths = await listSearchPaths(c.env.DB, c.get("user").id);
    return c.json({ paths });
  })
  .post("/preview", async (c) => {
    const user = c.get("user");
    const profile = await loadProfile(c.env, user.id, user.email);
    const commit = readCommit(await c.req.json().catch(() => ({})));
    return c.json(await previewSearchPaths(c.env.DB, user.id, profile.preferences, commit));
  })
  .put("/", async (c) => {
    const user = c.get("user");
    const profile = await loadProfile(c.env, user.id, user.email);
    const commit = readCommit(await c.req.json().catch(() => ({})), { action: "replace" });
    return c.json({ paths: await commitSearchPaths(c.env.DB, user.id, profile.preferences, commit) });
  })
  .post("/", async (c) => {
    const user = c.get("user");
    const profile = await loadProfile(c.env, user.id, user.email);
    const commit = readCommit(await c.req.json().catch(() => ({})), { action: "create" });
    return c.json({ paths: await commitSearchPaths(c.env.DB, user.id, profile.preferences, commit) }, 201);
  })
  .patch("/order", async (c) => {
    const user = c.get("user");
    const profile = await loadProfile(c.env, user.id, user.email);
    const commit = readCommit(await c.req.json().catch(() => ({})), { action: "reorder" });
    return c.json({ paths: await commitSearchPaths(c.env.DB, user.id, profile.preferences, commit) });
  })
  .patch("/:id", async (c) => {
    const user = c.get("user");
    const profile = await loadProfile(c.env, user.id, user.email);
    const commit = readCommit(await c.req.json().catch(() => ({})), { action: "update", id: c.req.param("id") });
    return c.json({ paths: await commitSearchPaths(c.env.DB, user.id, profile.preferences, commit) });
  })
  .delete("/:id", async (c) => {
    const user = c.get("user");
    const profile = await loadProfile(c.env, user.id, user.email);
    const commit = readCommit(await c.req.json().catch(() => ({})), { action: "delete", id: c.req.param("id") });
    return c.json({ paths: await commitSearchPaths(c.env.DB, user.id, profile.preferences, commit) });
  });
