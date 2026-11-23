#!/usr/bin/env node
// One-time Bambu account login for bambu-mcp's MakerWorld tools (MakerWorld downloads need an account
// session). Logs in with a code Bambu emails (no password is asked for): asks on the terminal for the
// email, then the emailed code (and an authenticator code if the account has 2FA), then writes only the
// access token, as BAMBU_CLOUD_TOKEN=..., to an env file with mode 600.
// It prints no secret: not a code, not the token, not raw API responses.
// File: $BAMBU_CLOUD_TOKEN_FILE, default ~/.config/bambu-mcp/cloud.env.
import { createInterface } from "node:readline";
import { mkdirSync, openSync, writeSync, closeSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const API = "https://api.bambulab.com";
const file = process.env.BAMBU_CLOUD_TOKEN_FILE || join(homedir(), ".config", "bambu-mcp", "cloud.env");

const lines = createInterface({ input: process.stdin, terminal: false });
const queue = [];
const waiting = [];
lines.on("line", (l) => (waiting.length ? waiting.shift()(l) : queue.push(l)));
let closed = false;
lines.on("close", () => { closed = true; waiting.splice(0).forEach((w) => w(null)); });

/** Read one line (codes are one-time, so they are typed with echo on). */
async function ask(prompt) {
  process.stderr.write(prompt);
  const line = queue.length ? queue.shift() : closed ? null : await new Promise((r) => waiting.push(r));
  if (line === null) fail("input ended");
  return line.trim();
}

function fail(msg) {
  process.stderr.write(`bambu cloud login: ${msg}\n`);
  process.exit(1);
}

/** POST JSON; returns {status, body, cookies}. Never prints the body: it can hold a token. */
async function post(url, payload, headers = {}) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...headers },
      body: JSON.stringify(payload),
      // A 307/308 would resend the body to wherever it points; refuse redirects instead.
      redirect: "error",
    });
  } catch (e) {
    fail(`cannot reach ${new URL(url).host} (${e.cause?.code ?? e.message})`);
  }
  const text = await res.text();
  const cookies = res.headers.getSetCookie?.() ?? [];
  let body = {};
  // Bambu answers some successes (sendemail/code) with an empty 200.
  if (text.length > 0 || !res.ok) {
    try { body = JSON.parse(text) ?? {}; } catch {
      fail(`${new URL(url).host} answered ${describe(res, text, cookies)} that is not JSON`);
    }
  }
  return { status: res.status, body, cookies };
}

/** Secret-free shape of an answer: status, type, size and cookie names, never values. */
function describe(res, text, cookies) {
  const names = cookies.map((c) => c.split("=")[0]).join(",");
  return `HTTP ${res.status} (${res.headers.get("content-type") ?? "no type"}, ${text.length} bytes${names ? `, cookies ${names}` : ""})`;
}

/** A short, secret-free reason from an error answer. */
function reason(r) {
  const b = r.body;
  const msg = [b.code, b.error, b.message, b.loginType && `loginType ${b.loginType}`].filter((x) => x !== undefined && x !== null && x !== "").join(" ");
  return `HTTP ${r.status}${msg ? `: ${String(msg).slice(0, 160)}` : ""}`;
}

function save(token, expiresIn) {
  if (typeof token !== "string" || !/^[\x21-\x7e]+$/.test(token)) fail("login answered without a usable token");
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  const until = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : undefined;
  writeSync(fd, `# Bambu account token for bambu-mcp MakerWorld tools${until ? `, expires about ${until.toISOString().slice(0, 10)}` : ""}\nBAMBU_CLOUD_TOKEN=${token}\n`);
  closeSync(fd);
  try { renameSync(tmp, file); } catch (e) {
    try { unlinkSync(tmp); } catch {}
    fail(`could not write ${file} (${e.code ?? e.message})`);
  }
  process.stderr.write(`saved: ${file} (mode 600)${until ? `, expires about ${until.toISOString().slice(0, 10)}` : ""}\n`);
  process.exit(0);
}

async function sendCode() {
  const sent = await post(`${API}/v1/user-service/user/sendemail/code`, { email: account, type: "codeLogin" });
  if (sent.status >= 400) fail(`could not send the email code (${reason(sent)})`);
  process.stderr.write(`Asked Bambu to email a login code to ${account} (check spam too).\n`);
}

/** 2FA accounts: a CSRF cookie from bambulab.com, then the authenticator code; the token comes back as a cookie. */
async function tfa(tfaKey) {
  let csrf;
  try {
    const c = await fetch("https://bambulab.com/api/csrf", { redirect: "error" });
    csrf = (c.headers.getSetCookie?.() ?? []).map((x) => /^bbl_csrf_token=([^;]+)/.exec(x)?.[1]).find(Boolean);
  } catch (e) {
    fail(`cannot reach bambulab.com (${e.cause?.code ?? e.message})`);
  }
  if (!csrf) fail("bambulab.com gave no CSRF cookie for the 2FA step");
  const tfaCode = await ask("Authenticator app code: ");
  const t = await post("https://bambulab.com/api/sign-in/tfa", { tfaKey, tfaCode }, { "x-bbl-csrf-token": csrf, cookie: `bbl_csrf_token=${csrf}` });
  const token = t.cookies.map((c) => /^token=([^;]+)/.exec(c)?.[1]).find(Boolean);
  if (token) save(decodeURIComponent(token), undefined);
  fail(`2FA code refused (${reason(t)})`);
}

const account = await ask("Bambu account email: ");
if (!account.includes("@")) fail("that is not an email address");
await sendCode();
let r;
for (let tries = 0; tries < 3; tries++) {
  const code = await ask("Code from the Bambu email: ");
  if (!/^\d{4,8}$/.test(code)) { process.stderr.write("the code is digits only; try again\n"); continue; }
  r = await post(`${API}/v1/user-service/user/login`, { account, code });
  if (r.body.accessToken) save(r.body.accessToken, r.body.expiresIn);
  if (r.body.loginType === "tfa" && r.body.tfaKey) await tfa(r.body.tfaKey);
  if (r.status === 400 && r.body.code === 1) { process.stderr.write("that code expired; sending a new one\n"); await sendCode(); continue; }
  if (r.status === 400 && r.body.code === 2) { process.stderr.write("wrong code; try again\n"); continue; }
  break;
}
fail(r ? `login refused (${reason(r)})` : "no valid code entered");
