// MakerWorld client. MakerWorld has no official public API; these are the endpoints its web app uses.
// Search and design reads need no login; a 3MF download needs a Bambu account token (see
// scripts/cloud-login.mjs), read from BAMBU_CLOUD_TOKEN or the env file it writes. The token is
// sent only in request headers to makerworld.com and is never returned, logged or put in a URL.
// node:https, not fetch: MakerWorld's bot check answers undici's fetch with 403 but serves node:https.
import { createWriteStream, existsSync, readFileSync, renameSync, rmSync } from "node:fs";
import { request } from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage } from "node:http";

const HOST = "makerworld.com";
const UA = "bambu-mcp (+https://github.com/Eyalm321/bambu-mcp)";
/** A MakerWorld 3MF is small (a few MB); refuse anything absurd rather than fill the disk. */
export const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

export function tokenFile(): string {
  return process.env.BAMBU_CLOUD_TOKEN_FILE?.trim() || join(homedir(), ".config", "bambu-mcp", "cloud.env");
}

/** The Bambu account token, or undefined when none is set up. */
export function cloudToken(): string | undefined {
  const env = process.env.BAMBU_CLOUD_TOKEN?.trim();
  if (env) return env;
  const f = tokenFile();
  if (!existsSync(f)) return undefined;
  const m = /^BAMBU_CLOUD_TOKEN=(\S+)\s*$/m.exec(readFileSync(f, "utf8"));
  return m?.[1];
}

function get(url: URL, headers: Record<string, string>): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET", headers: { "user-agent": UA, accept: "application/json", ...headers } }, resolve);
    req.setTimeout(30_000, () => req.destroy(new Error(`timeout fetching ${url.host}${url.pathname}`)));
    req.on("error", reject);
    req.end();
  });
}

async function body(res: IncomingMessage, max = 20 * 1024 * 1024): Promise<string> {
  const parts: Buffer[] = [];
  let n = 0;
  for await (const c of res) {
    n += c.length;
    if (n > max) { res.destroy(); throw new Error("MakerWorld answer too large"); }
    parts.push(c);
  }
  return Buffer.concat(parts).toString("utf8");
}

/** GET a MakerWorld API path as JSON; errors carry the status and MakerWorld's own message only. */
export async function mwJson(path: string, query: Record<string, string | number | undefined> = {}, auth = false): Promise<any> {
  const url = new URL(`https://${HOST}${path}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
  const headers: Record<string, string> = {};
  if (auth) {
    const t = cloudToken();
    if (!t) throw new Error(`No Bambu account token: run the one-time login (scripts/cloud-login.mjs), which writes ${tokenFile()}`);
    headers.authorization = `Bearer ${t}`;
    headers.cookie = `token=${t}`;
  }
  const res = await get(url, headers);
  const text = await body(res);
  let json: any;
  try { json = JSON.parse(text); } catch {
    throw new Error(`MakerWorld answered ${res.statusCode} with a non-JSON page (bot check?) for ${path}`);
  }
  if ((res.statusCode ?? 500) >= 400) {
    const msg = String(json?.error ?? json?.message ?? "").slice(0, 200);
    if (auth && (res.statusCode === 401 || res.statusCode === 403))
      throw new Error(`MakerWorld refused the download (${res.statusCode}${msg ? `: ${msg}` : ""}); the Bambu token may be missing or expired: rerun the one-time login`);
    throw new Error(`MakerWorld ${res.statusCode}${msg ? `: ${msg}` : ""} for ${path}`);
  }
  return json;
}

/** Design id from a number, a numeric string or a makerworld.com/.../models/<id> URL. */
export function designId(ref: string | number): number {
  const s = String(ref).trim();
  const m = /^\d+$/.test(s) ? s : /makerworld\.com\/(?:[a-z-]+\/)?models\/(\d+)/i.exec(s)?.[1];
  if (!m) throw new Error(`Not a MakerWorld design id or model URL: ${s}`);
  return Number(m);
}

/** The fields of a print profile (MakerWorld "instance") a caller needs to pick one. */
export function summarizeInstance(i: any) {
  return {
    instanceId: i.id,
    profileId: i.profileId,
    title: i.title,
    isDefault: Boolean(i.isDefault),
    plates: i.extention?.modelInfo?.plates?.length,
    printMinutes: typeof i.prediction === "number" ? Math.round(i.prediction / 60) : undefined,
    grams: i.weight,
    needAms: i.needAms,
    filaments: (i.instanceFilaments ?? []).map((f: any) => ({ type: f.type, color: f.color, grams: Number(f.usedG) || undefined })),
    printCount: i.printCount,
    downloadCount: i.downloadCount,
  };
}

/** Stream a signed file URL to `to` (written to a temp name, renamed when complete). */
export async function downloadTo(fileUrl: string, to: string, redirects = 3): Promise<number> {
  const url = new URL(fileUrl);
  if (url.protocol !== "https:") throw new Error("MakerWorld file URL is not https");
  const res = await get(url, { accept: "*/*" });
  const code = res.statusCode ?? 500;
  if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
    res.resume();
    return downloadTo(new URL(res.headers.location, url).toString(), to, redirects - 1);
  }
  if (code >= 400) { res.resume(); throw new Error(`file download answered ${code}`); }
  const declared = Number(res.headers["content-length"]);
  if (declared > MAX_DOWNLOAD_BYTES) { res.destroy(); throw new Error(`file is ${declared} bytes, above the ${MAX_DOWNLOAD_BYTES} limit`); }
  return saveStream(res, to);
}

/**
 * Write a byte stream to `to` via a temp file renamed when complete. Every write-side error
 * (unwritable dir, full disk) rejects here: an 'error' event with no listener would exit the server.
 */
export async function saveStream(src: AsyncIterable<Buffer> & { destroy?: (e?: Error) => void }, to: string): Promise<number> {
  // A unique temp name, so a .part left by a killed run never blocks the next download.
  const tmp = `${to}.${process.pid}-${Date.now()}.part`;
  const out = createWriteStream(tmp, { flags: "wx", mode: 0o644 });
  let failed: Error | undefined;
  // Destroy the source without an error: an error passed on would be emitted on it unheard.
  out.on("error", (e) => { failed ??= e; src.destroy?.(); });
  const wait = (ev: "open" | "drain") =>
    new Promise<void>((r, j) => {
      if (failed) return j(failed);
      const onErr = (e: Error) => { out.off(ev, onOk); j(e); };
      const onOk = () => { out.off("error", onErr); r(); };
      out.once(ev, onOk);
      out.once("error", onErr);
    });
  let opened = false;
  let n = 0;
  try {
    await wait("open");
    opened = true;
    for await (const c of src) {
      if (failed) throw failed;
      n += c.length;
      if (n > MAX_DOWNLOAD_BYTES) throw new Error(`file is above the ${MAX_DOWNLOAD_BYTES} byte limit`);
      if (!out.write(c)) await wait("drain");
    }
    if (failed) throw failed;
    await new Promise<void>((r, j) => out.end((e?: Error | null) => (e ? j(e) : failed ? j(failed) : r())));
    renameSync(tmp, to);
  } catch (e) {
    src.destroy?.();
    out.destroy();
    // Only remove a temp file this call created.
    if (opened) rmSync(tmp, { force: true });
    throw failed ?? e;
  }
  return n;
}
