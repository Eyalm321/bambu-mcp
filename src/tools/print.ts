import { z } from "zod";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import {
  uploadFile,
  startPrint,
  type PrintOptions,
  pausePrint,
  resumePrint,
  stopPrint,
} from "../client.js";
import { checkPath } from "../limits.js";
import { checkSdSpace } from "../sdguard.js";

const cali = z.enum(["auto", "on", "off"]).optional();

export const printTools = [
  {
    name: "bambu_upload",
    description:
      "Upload a sliced .3mf/.gcode from this machine to the printer over FTPS. Returns the remote filename to hand to bambu_print_file.",
    inputSchema: z.object({
      localPath: z.string().describe("Path to the sliced file on this machine"),
      remoteName: z
        .string()
        .optional()
        .describe("Name on the printer (default: the local basename)"),
    }),
    handler: async (args: { localPath: string; remoteName?: string }) => {
      // Checked first: with a root set, a path outside it is refused before
      // the reply could say whether it exists.
      const local = checkPath(args.localPath, "read");
      if (!existsSync(local)) {
        throw new Error(`No such file: ${args.localPath}`);
      }
      const remote = args.remoteName ?? basename(args.localPath);
      await checkSdSpace("the upload");
      await uploadFile(local, remote);
      return { uploaded: remote };
    },
  },
  {
    name: "bambu_print_file",
    description:
      "Start printing a .3mf already on the printer (upload it first, or pick one from bambu_list_files).",
    inputSchema: z.object({
      remoteName: z.string().describe("Filename on the printer's FTPS storage"),
      plate: z
        .number()
        .int()
        .optional()
        .describe("Plate number inside a multi-plate .3mf (1-based, default 1)"),
      useAms: z
        .boolean()
        .optional()
        .describe("Pull filament from the AMS if present (default true)"),
      amsMapping: z
        .array(z.number().int().refine((t) => (t >= 0 && t <= 15) || t === 254 || t === 255, "an AMS tray 0-15, 254 (external spool) or 255 (unmapped)"))
        .optional()
        .describe(
          "Map each filament in the plate to an AMS slot (0-based), e.g. [2] prints from slot 2, [0,3] maps filament 1→slot 0, filament 2→slot 3. Trays 0-15 (AMS 0-3), 254 = external spool, 255 = unmapped. See bambu_ams. Default [0]."
        ),
      bedLeveling: cali.describe('Bed leveling before the print: "auto" (default, the printer decides, as Bambu Studio sends), "on" or "off"'),
      flowCali: cali.describe('Flow dynamics (extrusion) calibration: "auto" (default), "on" or "off"'),
      nozzleOffsetCali: cali.describe('Nozzle offset calibration on printers that have it: "auto" (default), "on" or "off"'),
      vibrationCali: z.boolean().optional().describe("Run the vibration (resonance) test first (default false, as Bambu Studio)"),
      layerInspect: z.boolean().optional().describe("First-layer inspection where supported (default true, as Bambu Studio)"),
      timelapse: z.boolean().optional().describe("Record a timelapse to the printer's storage (default false)"),
      bedType: z
        .string()
        .regex(/^[a-z_]{1,40}$/)
        .optional()
        .describe('Plate type, e.g. "textured_plate", "cool_plate", "hot_plate" (default "auto")'),
    }),
    handler: async (args: { remoteName: string } & PrintOptions) => {
      await checkSdSpace("the print");
      const { remoteName, ...options } = args;
      await startPrint(remoteName, options);
      return {
        printing: remoteName,
        plate: args.plate ?? 1,
        amsMapping: args.amsMapping ?? [0],
        bedLeveling: args.bedLeveling ?? "auto",
        flowCali: args.flowCali ?? "auto",
      };
    },
  },
  {
    name: "bambu_pause",
    description: "Pause the running print.",
    inputSchema: z.object({}),
    handler: async () => {
      await pausePrint();
      return { ok: "paused" };
    },
  },
  {
    name: "bambu_resume",
    description: "Resume a paused print.",
    inputSchema: z.object({}),
    handler: async () => {
      await resumePrint();
      return { ok: "resumed" };
    },
  },
  {
    name: "bambu_stop",
    description: "Stop/cancel the running print. Not resumable.",
    inputSchema: z.object({}),
    handler: async () => {
      await stopPrint();
      return { ok: "stopped" };
    },
  },
];
