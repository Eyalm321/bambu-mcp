// Fail fast before an upload or print while the printer reports its SD card full: a job started then
// dies in prep (HMS 0500-0100-0003-0004, print_error 0300-400C) after minutes of heating.
import { hms, listFiles } from "./client.js";

export const SD_FULL_HMS = "0500-0100-0003-0004";

/** Throw when the SD-full HMS code is active. A failed health read does not block: the guard is advisory. */
export async function checkSdSpace(action: string): Promise<void> {
  let active: { code: string }[];
  try {
    active = await hms();
  } catch {
    return;
  }
  if (!active.some((e) => e.code === SD_FULL_HMS)) return;
  let used = "";
  try {
    const { totalBytes } = await listFiles("/");
    used = ` Top-level files use ${(totalBytes / 1e6).toFixed(1)} MB.`;
  } catch {}
  throw new Error(
    `Refused ${action}: the printer reports its SD card is full (HMS ${SD_FULL_HMS}), so the job would fail in prep.${used} ` +
      "Free space (bambu_list_files, then delete old files or timelapses), clear the message on the printer screen, and retry.",
  );
}
