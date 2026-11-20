// Deployment limits, all optional and read from env at call time:
//   BAMBU_PATH_ROOT       local paths must resolve (realpath) inside this dir
//   BAMBU_DISABLED_TOOLS  comma list of tool names that are not registered
//   BAMBU_MAX_NOZZLE_C / BAMBU_MAX_BED_C  temperature caps for set_temps and gcode
// A server-side limit holds even when the client's own permission rules are loose.
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

function pathRoot(): string | undefined {
  const r = process.env.BAMBU_PATH_ROOT?.trim();
  if (!r) return undefined;
  if (!existsSync(r)) throw new Error(`BAMBU_PATH_ROOT does not exist: ${r}`);
  return realpathSync(r);
}

function inside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Resolve a local path and refuse it when it lies outside BAMBU_PATH_ROOT.
 * Reads need an existing file; a write target may be new, so its parent
 * directory is resolved instead (an existing target is resolved itself, so a
 * symlink cannot point the write outside the root).
 */
export function checkPath(p: string, mode: "read" | "write"): string {
  const root = pathRoot();
  if (!root) return p;
  const abs = resolve(p);
  let real: string;
  if (existsSync(abs)) real = realpathSync(abs);
  else if (mode === "write" && existsSync(dirname(abs)))
    real = join(realpathSync(dirname(abs)), basename(abs));
  else throw new Error(`No such ${mode === "read" ? "file" : "directory"}: ${mode === "read" ? p : dirname(abs)}`);
  if (!inside(root, real)) {
    throw new Error(`Refused: ${p} is outside BAMBU_PATH_ROOT (${root})`);
  }
  return real;
}

/** Default directory for files the server names itself (snapshots). */
export function defaultDir(): string {
  return pathRoot() ?? process.cwd();
}

export function disabledTools(): Set<string> {
  return new Set(
    (process.env.BAMBU_DISABLED_TOOLS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/** Drop BAMBU_DISABLED_TOOLS from the list, so no client can call them. */
export function enabledTools<T extends { name: string }>(tools: T[]): T[] {
  const disabled = disabledTools();
  for (const name of disabled) {
    if (!tools.some((t) => t.name === name))
      console.error(`BAMBU_DISABLED_TOOLS: no tool named ${name}`);
  }
  return tools.filter((t) => !disabled.has(t.name));
}

function cap(name: "BAMBU_MAX_NOZZLE_C" | "BAMBU_MAX_BED_C"): number | undefined {
  const v = process.env[name]?.trim();
  if (!v) return undefined;
  const n = Number(v);
  // Fail closed: a typo in the cap must not silently remove it.
  if (!Number.isFinite(n)) throw new Error(`${name} is not a number: ${v}`);
  return n;
}

export function checkTemps(nozzleC?: number, bedC?: number): void {
  const maxN = cap("BAMBU_MAX_NOZZLE_C");
  const maxB = cap("BAMBU_MAX_BED_C");
  if (maxN !== undefined && nozzleC !== undefined && nozzleC > maxN)
    throw new Error(`Refused: nozzle ${nozzleC} °C is above BAMBU_MAX_NOZZLE_C (${maxN})`);
  if (maxB !== undefined && bedC !== undefined && bedC > maxB)
    throw new Error(`Refused: bed ${bedC} °C is above BAMBU_MAX_BED_C (${maxB})`);
}

/**
 * Apply the same caps to temperature commands inside raw G-code, so the
 * bambu_gcode escape hatch cannot step around bambu_set_temps' limit.
 * M104/M109 set the nozzle, M140/M190 the bed; S and R both set a target.
 */
export function checkGcodeTemps(gcode: string): void {
  for (const raw of gcode.split(/\r?\n/)) {
    // Drop a comment and an optional line number ("N12 M104 S200").
    const line = raw.replace(/;.*$/, "").trim().toUpperCase().replace(/^N\d+\s*/, "");
    const m = /^M(104|109|140|190)(?!\d)(.*)$/.exec(line);
    if (!m) continue;
    const nozzle = m[1] === "104" || m[1] === "109";
    for (const p of m[2].matchAll(/[SR]\s*(-?\d+(?:\.\d+)?)/g)) {
      const t = Number(p[1]);
      if (nozzle) checkTemps(t, undefined);
      else checkTemps(undefined, t);
    }
  }
}
