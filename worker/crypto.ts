const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Cloudflare Workers caps PBKDF2 at 100,000 iterations.
const PBKDF2_ITERATIONS = 100_000;

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32): string {
  return toB64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/[+/=]/g, (c) =>
    c === "+" ? "-" : c === "/" ? "_" : "",
  );
}

export async function sha256(text: string): Promise<string> {
  return toB64(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, expected] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !expected) return false;
  const actual = new Uint8Array(await pbkdf2(password, fromB64(salt), Number(iter)));
  const want = fromB64(expected);
  if (actual.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= (actual[i] ?? 0) ^ (want[i] ?? 0);
  return diff === 0;
}

async function dataKey(secret: string): Promise<CryptoKey> {
  const raw = fromB64(secret);
  if (raw.length !== 32) throw new Error("DATA_KEY must be 32 bytes, base64-encoded");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptJson(secret: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await dataKey(secret), encoder.encode(JSON.stringify(value)));
  return `${toB64(iv)}.${toB64(ct)}`;
}

export async function decryptJson<T>(secret: string, payload: string): Promise<T> {
  const plain = await decryptBytes(secret, payload);
  return JSON.parse(decoder.decode(plain)) as T;
}

export async function encryptBytes(secret: string, value: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new Uint8Array(value.byteLength);
  plain.set(value);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await dataKey(secret), plain);
  return `${toB64(iv)}.${toB64(ct)}`;
}

export async function decryptBytes(secret: string, payload: string): Promise<Uint8Array> {
  const parts = payload.split(".");
  const iv = parts[0] ?? "";
  const ct = parts[1] ?? "";
  if (parts.length !== 2 || !iv || !ct) throw new Error("Malformed ciphertext");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await dataKey(secret), fromB64(ct));
  return new Uint8Array(pt);
}
