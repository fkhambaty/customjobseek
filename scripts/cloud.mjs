// Shared by the seed scripts: reads local credentials and runs SQL on the live D1 database.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const ROOT = new URL("..", import.meta.url);

export function envFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [k, ...rest] = line.split("=");
    out[k.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function wranglerOAuthToken() {
  const candidates = [
    join(homedir(), "AppData", "Roaming", "xdg.config", ".wrangler", "config", "default.toml"),
    join(homedir(), ".config", "wrangler", "config", "default.toml"),
    join(homedir(), ".wrangler", "config", "default.toml"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const m = text.match(/oauth_token\s*=\s*"([^"]+)"/);
    if (m?.[1]) return m[1];
  }
  return "";
}

const home = process.env.HOME || process.env.USERPROFILE || homedir();
const cfPaths = [
  join(home, ".config", "fk-products", "cloudflare.env"),
  join(homedir(), ".config", "fk-products", "cloudflare.env"),
];
let cf = {};
for (const p of cfPaths) {
  if (existsSync(p)) {
    cf = envFile(p);
    break;
  }
}
const token = process.env.CLOUDFLARE_API_TOKEN || cf.CLOUDFLARE_API_TOKEN || wranglerOAuthToken();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || cf.CLOUDFLARE_ACCOUNT_ID || "ec00d4a6131c20118d82605d6b969c8e";
if (!token) throw new Error("Set CLOUDFLARE_API_TOKEN or log in with wrangler (oauth token).");

const wrangler = readFileSync(new URL("wrangler.jsonc", ROOT), "utf8");
const databaseId = wrangler.match(/"database_id":\s*"([^"]+)"/)?.[1];
if (!databaseId || databaseId.startsWith("00000000")) throw new Error("Set the real D1 database_id in wrangler.jsonc first.");

export async function d1(sql, params = []) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!body.success) throw new Error(JSON.stringify(body.errors));
  return body.result?.[0]?.results ?? [];
}
