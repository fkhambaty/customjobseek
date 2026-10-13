// Shared by the seed scripts: reads local credentials and runs SQL on the live D1 database.
import { readFileSync } from "node:fs";

export const ROOT = new URL("..", import.meta.url);

export function envFile(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [k, ...rest] = line.split("=");
    out[k.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const cf = envFile(`${process.env.HOME}/.config/fk-products/cloudflare.env`);
const wrangler = readFileSync(new URL("wrangler.jsonc", ROOT), "utf8");
const databaseId = wrangler.match(/"database_id":\s*"([^"]+)"/)?.[1];
if (!databaseId || databaseId.startsWith("00000000")) throw new Error("Set the real D1 database_id in wrangler.jsonc first.");

export async function d1(sql, params = []) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cf.CLOUDFLARE_ACCOUNT_ID}/d1/database/${databaseId}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${cf.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(JSON.stringify(body.errors));
  return body.result?.[0]?.results ?? [];
}
