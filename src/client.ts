import {
  PrinterController,
  FileController,
  CameraController,
  getHmsErrorMessage,
} from "bambu-js";
import { writeFile } from "node:fs/promises";

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
    // bambu-js model strings are case-sensitive (P1S / H2D). Normalize so
    // BAMBU_MODEL=p1s and P1S both work. P2S uses the P1S dialect.
    model: env("BAMBU_MODEL", "P1S").toUpperCase() as any,
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

export interface AmsSlot {
  slot: number;
  type: string | null;
  colorHex: string | null;
  nozzleMinC: number | null;
  nozzleMaxC: number | null;
  active: boolean;
}
export interface AmsUnit {
  id: number;
  humidity: string | null;
  tempC: string | null;
  slots: AmsSlot[];
}

function hex6(c: unknown): string | null {
  if (typeof c !== "string" || c.length < 6) return null;
  return "#" + c.slice(0, 6).toUpperCase();
}

/** Parsed AMS state: units, per-slot filament type + color, active slot. */
export async function amsStatus(): Promise<{ units: AmsUnit[]; activeSlot: number | null }> {
  const r = await refreshReport();
  const raw = (r.ams as any)?.ams ?? [];
  const activeSlot =
    (r.ams as any)?.tray_now != null ? Number((r.ams as any).tray_now) : null;
  const units: AmsUnit[] = raw.map((u: any) => ({
    id: Number(u.id),
    humidity: u.humidity ?? null,
    tempC: u.temp ?? null,
    slots: (u.tray ?? []).map((t: any) => ({
      slot: Number(t.id),
      type: t.tray_type || null,
      colorHex: hex6(t.tray_color),
      nozzleMinC: t.nozzle_temp_min ? Number(t.nozzle_temp_min) : null,
      nozzleMaxC: t.nozzle_temp_max ? Number(t.nozzle_temp_max) : null,
      active: activeSlot != null && Number(t.id) === activeSlot,
    })),
  }));
  return { units, activeSlot };
}

export async function pausePrint(): Promise<void> {
  await sendCommand({ print: { command: "pause", sequence_id: nextSeq() } });
}

// --------------------------------------------------------------------------- //
// Direct machine control (MQTT)
// --------------------------------------------------------------------------- //
/** Run a raw G-code line (universal escape hatch: move, extrude, fan, temp…). */
export async function runGcode(line: string): Promise<void> {
  const param = line.endsWith("\n") ? line : line + "\n";
  await sendCommand({
    print: { command: "gcode_line", param, sequence_id: nextSeq() },
  });
}

/** Set target temperatures (°C) via M104 (nozzle) / M140 (bed). */
export async function setTemps(nozzleC?: number, bedC?: number): Promise<void> {
  const lines: string[] = [];
  if (nozzleC != null) lines.push(`M104 S${Math.round(nozzleC)}`);
  if (bedC != null) lines.push(`M140 S${Math.round(bedC)}`);
  if (!lines.length) throw new Error("Provide nozzleC and/or bedC");
  await runGcode(lines.join("\n"));
}

/** Home all axes (G28). */
export async function home(): Promise<void> {
  await runGcode("G28");
}

/** Chamber light control. */
export async function setLight(
  mode: "on" | "off" | "flashing"
): Promise<void> {
  await sendCommand({
    system: {
      command: "ledctrl",
      led_node: "chamber_light",
      led_mode: mode,
      led_on_time: 500,
      led_off_time: 500,
      loop_times: 0,
      interval_time: 0,
      sequence_id: nextSeq(),
    },
  });
}

/** Print speed profile: 1 silent, 2 standard, 3 sport, 4 ludicrous. */
export async function setSpeed(level: 1 | 2 | 3 | 4): Promise<void> {
  await sendCommand({
    print: { command: "print_speed", param: String(level), sequence_id: nextSeq() },
  });
}

// --------------------------------------------------------------------------- //
// Health (HMS)
// --------------------------------------------------------------------------- //
function hmsKey(attr: number, code: number): string {
  const w = (n: number, s: number) => ((n >> s) & 0xffff).toString(16).padStart(4, "0");
  return `${w(attr, 16)}-${w(attr, 0)}-${w(code, 16)}-${w(code, 0)}`;
}

/** Active HMS health entries, decoded to human messages. */
export async function hms(): Promise<
  { code: string; message: string }[]
> {
  const r = await refreshReport();
  const raw = (r.hms as any[]) ?? [];
  return raw.map((e) => {
    const code = hmsKey(Number(e.attr), Number(e.code));
    return { code, message: getHmsErrorMessage(code) || "Unknown HMS code" };
  });
}

// --------------------------------------------------------------------------- //
// Camera
// --------------------------------------------------------------------------- //
/** Capture one camera frame (JPEG) and write it to `outputPath`. */
export async function snapshot(outputPath: string): Promise<{ path: string; bytes: number }> {
  const cam = CameraController.create({
    model: env("BAMBU_MODEL", "P1S").toUpperCase() as any,
    host: env("BAMBU_IP"),
    accessCode: env("BAMBU_ACCESS_CODE"),
  });
  const frame = await cam.captureFrame();
  await writeFile(outputPath, frame.imageData);
  return { path: outputPath, bytes: frame.imageData.length };
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
  useAms = true,
  amsMapping?: number[]
): Promise<void> {
  const base = remoteName.replace(/\.[^.]+$/, "");
  // ams_mapping maps each filament in the plate to an AMS slot (0-based).
  // Default [0] = everything from slot 0. Ignored when use_ams is false.
  const mapping = useAms ? amsMapping ?? [0] : [255];
  await sendCommand({
    print: {
      command: "project_file",
      param: `Metadata/plate_${plate}.gcode`,
      url: `ftp:///${remoteName}`,
      subtask_name: base,
      use_ams: useAms,
      ams_mapping: mapping,
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

export async function downloadFile(remoteName: string, localPath: string): Promise<void> {
  const remote = remoteName.startsWith("/") ? remoteName : `/${remoteName}`;
  await withFtp((f) => f.downloadFile(remote, localPath));
}

export async function deleteFile(remoteName: string): Promise<void> {
  const remote = remoteName.startsWith("/") ? remoteName : `/${remoteName}`;
  await withFtp((f) => f.deleteFile(remote));
}

/** Test seam: reset the cached controller (used by unit tests). */
export function __reset(): void {
  controller = null;
  latestReport = {};
  seq = 0;
}
