#!/usr/bin/env node
// One-time Bambu account login for bambu-mcp's MakerWorld tools (MakerWorld downloads need an account
// session). Asks on the terminal for email, password (not echoed) and the emailed or authenticator code,
// then writes only the access token, as BAMBU_CLOUD_TOKEN=..., to an env file with mode 600.
// It prints no secret: not the password, not the token, not raw API responses.
// File: $BAMBU_CLOUD_TOKEN_FILE, default ~/.config/bambu-mcp/cloud.env.
import { spawnSync } from "node:child_process";
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
lines.on("close", () => waiting.splice(0).forEach((w) => w(null)));

// stty on the controlling terminal stops echo without a dependency. Echo is restored on every exit
// path, Ctrl-C included, so an aborted login never leaves the terminal silent.
let echoOff = false;
function echo(on) {
  spawnSync("stty", [on ? "echo" : "-echo"], { stdio: ["inherit", "ignore", "ignore"] });
  echoOff = !on;
}
process.on("exit", () => { if (echoOff) echo(true); });
process.on("SIGINT", () => { if (echoOff) { echo(true); process.stderr.write("\n"); } process.exit(130); });

/** Read one line; with hidden set, terminal echo is off while it is typed. */
async function ask(prompt, hidden = false) {
  process.stderr.write(prompt);
  const tty = hidden && process.stdin.isTTY;
  if (tty) echo(false);
  const line = queue.length ? queue.shift() : await new Promise((r) => waiting.push(r));
  if (tty) { echo(true); process.stderr.write("\n"); }
  if (line === null) fail("input ended");
  return line.trim();
}

function fail(msg) {
  process.stderr.write(`bambu cloud login: ${msg}\n`);
  process.exit(1);
}

/** POST JSON; returns {status, body, cookies}. Never prints the body: it can hold a token. */
async function post(url, payload) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
      // A 307/308 would resend the password to wherever it points; refuse redirects instead.
      redirect: "error",
    });
  } catch (e) {
    fail(`cannot reach ${new URL(url).host} (${e.cause?.code ?? e.message})`);
  }
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch {
    fail(`${new URL(url).host} answered ${res.status} with a non-JSON page (${text.length} bytes; likely a bot check)`);
  }
  return { status: res.status, body: body ?? {}, cookies: res.headers.getSetCookie?.() ?? [] };
}

/** A short, secret-free reason from an error answer. */
function reason(r) {
  const b = r.body;
  const msg = [b.code, b.error, b.message].filter((x) => x !== undefined && x !== null && x !== "").join(" ");
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

const account = await ask("Bambu account email: ");
if (!account.includes("@")) fail("that is not an email address");
const password = await ask("Password (not shown): ", true);
let r = await post(`${API}/v1/user-service/user/login`, { account, password, apiError: "" });
if (r.body.accessToken) save(r.body.accessToken, r.body.expiresIn);

if (r.body.loginType === "verifyCode") {
  const sent = await post(`${API}/v1/user-service/user/sendemail/code`, { email: account, type: "codeLogin" });
  if (sent.status >= 400) fail(`could not send the email code (${reason(sent)})`);
  const code = await ask("Code from the Bambu email: ");
  r = await post(`${API}/v1/user-service/user/login`, { account, code });
  if (r.body.accessToken) save(r.body.accessToken, r.body.expiresIn);
} else if (r.body.loginType === "tfa" && r.body.tfaKey) {
  const tfaCode = await ask("Authenticator app code: ");
  const t = await post("https://bambulab.com/api/sign-in/tfa", { tfaKey: r.body.tfaKey, tfaCode });
  const cookie = t.cookies.map((c) => /^token=([^;]+)/.exec(c)?.[1]).find(Boolean);
  if (cookie) save(decodeURIComponent(cookie), undefined);
  r = t;
}
fail(`login refused (${reason(r)})`);
