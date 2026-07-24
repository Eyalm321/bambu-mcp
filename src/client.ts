import { PrinterController, FileController } from "bambu-js";

/**
 * Stateful Bambu Lab client for LAN mode.
 *
 * bambu-js is push-based (MQTT `report` events) with a low-level
 * `sendCommand(payload)` — there are no high-level print methods. This module
 * wraps it into request/response helpers the MCP tools can call:
 *
 *   - one lazily-connected PrinterController, caching the latest report
 *   - `pushall` to force a full state push for status/temps reads
 *   - hand-written Bambu command payloads for pause/resume/stop/print
 *   - a short-lived FileController (FTPS) for upload / list / delete
 *
 * Credentials come from env — never args, never chat:
 *   BAMBU_IP, BAMBU_ACCESS_CODE, BAMBU_SERIAL, BAMBU_MODEL (default "p1s").
 *
 * NOTE: bambu-js ships schemas for p1s/h2d only. P2S speaks the same
 * X1/P1-family MQTT dialect, so BAMBU_MODEL defaults to "p1s" and raw
 * sendCommand payloads are used regardless of the typed schema.
 */

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`${name} environment variable is not set`);
  }
  return v;
}

/** Raw Bambu `print` report object (loosely typed — keys vary by firmware). */
export interface PrintReport {
  gcode_state?: string;
  mc_percent?: number;
  mc_remaining_time?: number;
  nozzle_temper?: number;
  nozzle_target_temper?: number;
  bed_temper?: number;
  bed_target_temper?: number;
  chamber_temper?: number;
  subtask_name?: string;
  layer_num?: number;
  total_layer_num?: number;
  [key: string]: unknown;
}

let controller: PrinterController<any> | null = null;
let latestReport: PrintReport = {};
let seq = 0;

function nextSeq(): string {
  seq += 1;
  return String(seq);
}

/** Lazily connect the MQTT controller and start caching reports. */
async function getController(): Promise<PrinterController<any>> {
  if (controller && controller.isConnected) return controller;

  const c = PrinterController.create({
    model: env("BAMBU_MODEL", "p1s") as any,
    host: env("BAMBU_IP"),
    accessCode: env("BAMBU_ACCESS_CODE"),
    serial: env("BAMBU_SERIAL"),
    options: { autoReconnect: true },
  });

  c.on("report", (state: { print?: PrintReport }) => {
    if (state?.print) latestReport = { ...latestReport, ...state.print };
  });

  await c.connect();
  controller = c;
  return c;
}

/** Send a raw command payload over MQTT. */
async function sendCommand(payload: Record<string, unknown>): Promise<void> {
  const c = await getController();
  await c.sendCommand(payload);
}

/**
 * Force a full state push and return the freshest cached report.
 * Waits up to `timeoutMs` for a `report` event after `pushall`.
 */
export async function refreshReport(timeoutMs = 3000): Promise<PrintReport> {
  const c = await getController();
  const got = new Promise<void>((resolve) => {
    const onReport = () => {
      c.off("report", onReport);
      resolve();
    };
    c.on("report", onReport);
    setTimeout(() => {
      c.off("report", onReport);
      resolve();
    }, timeoutMs);
  });
  await c.sendCommand({
    pushing: { command: "pushall", sequence_id: nextSeq(), version: 1, push_target: 1 },
  });
  await got;
  return latestReport;
}

// --------------------------------------------------------------------------- //
// High-level operations used by the tools
// --------------------------------------------------------------------------- //
export async function status(): Promise<{
  state: string;
  percent: number | null;
  remainingMin: number | null;
  layer: number | null;
  totalLayers: number | null;
  subtask: string | null;
}> {
  const r = await refreshReport();
  return {
    state: r.gcode_state ?? "UNKNOWN",
    percent: r.mc_percent ?? null,
    remainingMin: r.mc_remaining_time ?? null,
    layer: r.layer_num ?? null,
    totalLayers: r.total_layer_num ?? null,
    subtask: r.subtask_name ?? null,
  };
}

export async function temps(): Promise<{
  nozzleC: number | null;
  nozzleTargetC: number | null;
  bedC: number | null;
  bedTargetC: number | null;
  chamberC: number | null;
}> {
  const r = await refreshReport();
  return {
    nozzleC: r.nozzle_temper ?? null,
    nozzleTargetC: r.nozzle_target_temper ?? null,
    bedC: r.bed_temper ?? null,
    bedTargetC: r.bed_target_temper ?? null,
    chamberC: r.chamber_temper ?? null,
  };
}

export async function pausePrint(): Promise<void> {
  await sendCommand({ print: { command: "pause", sequence_id: nextSeq() } });
}

export async function resumePrint(): Promise<void> {
  await sendCommand({ print: { command: "resume", sequence_id: nextSeq() } });
}

export async function stopPrint(): Promise<void> {
  await sendCommand({ print: { command: "stop", sequence_id: nextSeq() } });
}

/**
 * Start printing a .3mf already uploaded to the printer's FTP cache.
 * `remoteName` is the filename in the cache (see uploadFile / listFiles).
 */
export async function startPrint(
  remoteName: string,
  plate = 1,
  useAms = true
): Promise<void> {
  const base = remoteName.replace(/\.[^.]+$/, "");
  await sendCommand({
    print: {
      command: "project_file",
      param: `Metadata/plate_${plate}.gcode`,
      url: `ftp:///${remoteName}`,
      subtask_name: base,
      use_ams: useAms,
      timelapse: false,
      flow_cali: true,
      bed_leveling: true,
      layer_inspect: false,
      vibration_cali: true,
      bed_type: "auto",
      sequence_id: nextSeq(),
      project_id: "0",
      profile_id: "0",
      task_id: "0",
      subtask_id: "0",
    },
  });
}

// --------------------------------------------------------------------------- //
// File operations (FTPS) — short-lived connection per call
// --------------------------------------------------------------------------- //
async function withFtp<T>(fn: (f: FileController) => Promise<T>): Promise<T> {
  const f = FileController.create({
    host: env("BAMBU_IP"),
    accessCode: env("BAMBU_ACCESS_CODE"),
  });
  await f.connect();
  try {
    return await fn(f);
  } finally {
    await f.disconnect().catch(() => {});
  }
}

export async function listFiles(dir = "/"): Promise<string[]> {
  return withFtp(async (f) => {
    const entries = await f.listDir(dir);
    return entries.map((e) => e.name);
  });
}

export async function uploadFile(localPath: string, remoteName: string): Promise<void> {
  await withFtp((f) => f.uploadFile(localPath, `/${remoteName}`));
}

/** Test seam: reset the cached controller (used by unit tests). */
export function __reset(): void {
  controller = null;
  latestReport = {};
  seq = 0;
}
