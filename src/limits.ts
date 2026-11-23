// Deployment limits, all optional and read from env at call time:
//   BAMBU_PATH_ROOT       local paths must resolve (realpath) inside this dir
//   BAMBU_DISABLED_TOOLS  comma list of tool names that are not registered
//   BAMBU_MAX_NOZZLE_C / BAMBU_MAX_BED_C  temperature caps for set_temps and gcode
//   BAMBU_DELETE_PREFIX   delete_file and upload only touch top-level files whose name starts with this
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
 * M104/M109 set the nozzle, M140/M190 the bed; S and R both set a target, and
 * B is a second (auto-temperature maximum) target, so all three are capped.
 * I picks a stored preheat preset whose temperature is not in the line, so it
 * is refused while a cap is set.
 * Other commands that heat to a target in the line are capped too: M303 (PID
 * autotune heats E<n> or the bed, E-1, to S; any other heater is refused) and
 * the RepRap tool-temperature forms G10/M568 (S and R are nozzle targets).
 * Chamber commands (M141/M191) set a heater no cap covers, so while a cap is
 * set they are refused unless they turn it off (every target 0).
 * Fails closed while a cap is set: any CR or LF ends a line, the command is
 * found anywhere in the line, with spaces after the letter or leading zeros, every
 * target after it (up to the next temperature command) is checked, and a value that is not a
 * plain unsigned decimal is refused rather than guessed at.
 */
export function checkGcodeTemps(gcode: string): void {
  const maxN = cap("BAMBU_MAX_NOZZLE_C");
  const maxB = cap("BAMBU_MAX_BED_C");
  if (maxN === undefined && maxB === undefined) return;
  const plain = (v: string, raw: string): number => {
    if (!/^\d+(\.\d+)?$/.test(v))
      throw new Error(`Refused: temperature value "${v}" in "${raw.trim()}" is not a plain number`);
    return Number(v);
  };
  for (const raw of gcode.split(/[\r\n]/)) {
    const line = raw.replace(/;.*$/, "").toUpperCase();
    const cmds = [...line.matchAll(/(?:M\s*0*(104|109|140|190|141|191|303|568)|G\s*0*(10))(?!\d)/g)];
    cmds.forEach((m, k) => {
      const code = m[1] ?? "G10";
      const end = k + 1 < cmds.length ? cmds[k + 1].index : line.length;
      const params = line.slice(m.index + m[0].length, end);
      const targets = (letters: string) => [...params.matchAll(new RegExp(`[${letters}]\\s*([0-9A-Z+\\-.]*)`, "g"))].map((p) => plain(p[1], raw));
      if (code === "141" || code === "191") {
        // Turning the chamber heater off (every target 0) stays allowed.
        const t = targets("SR");
        if (t.length === 0 || t.some((v) => v !== 0))
          throw new Error(`Refused: "${raw.trim()}" sets the chamber heater, which no cap covers, while a cap is set`);
        return;
      }
      if (code === "303") {
        const e = [...params.matchAll(/E\s*([0-9A-Z+\-.]*)/g)].map((p) => p[1]);
        if (e.length > 1 || (e.length === 1 && !/^(-1|\d+)$/.test(e[0])))
          throw new Error(`Refused: "${raw.trim()}" autotunes a heater that cannot be checked against the cap`);
        for (const t of targets("S")) e[0] === "-1" ? checkTemps(undefined, t) : checkTemps(t, undefined);
        return;
      }
      if (code === "568" || code === "G10") {
        for (const t of targets("SR")) checkTemps(t, undefined);
        return;
      }
      if (params.includes("I"))
        throw new Error(`Refused: "${raw.trim()}" picks a preheat preset (I), whose temperature cannot be checked against the cap`);
      const nozzle = code === "104" || code === "109";
      for (const t of targets("SRB")) nozzle ? checkTemps(t, undefined) : checkTemps(undefined, t);
    });
  }
}

/**
 * With BAMBU_DELETE_PREFIX set, bambu_delete_file may remove, and bambu_upload may write, only a plain
 * top-level file name that starts with the prefix (an upload over an existing name destroys that file
 * just as a delete would); unset, every name is allowed. Fails closed: a prefix that is itself a path
 * refuses every such call.
 */
function checkScopedName(name: string, verb: "deleted" | "uploaded"): string {
  const prefix = process.env.BAMBU_DELETE_PREFIX?.trim();
  if (!prefix) return name;
  if (/[\/\\]|\.\./.test(prefix)) throw new Error(`BAMBU_DELETE_PREFIX must be a plain name prefix, not a path: ${prefix}`);
  if (/[\/\\]|\.\.|[\x00-\x1f]/.test(name) || !name.startsWith(prefix) || name.length === prefix.length)
    throw new Error(`Refused: with BAMBU_DELETE_PREFIX set, only a top-level file named ${prefix}* can be ${verb} (got ${JSON.stringify(name)})`);
  return name;
}

export const checkDeleteName = (name: string): string => checkScopedName(name, "deleted");
export const checkUploadName = (name: string): string => checkScopedName(name, "uploaded");
