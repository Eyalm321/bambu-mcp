import { z } from "zod";
import { status, temps, listFiles, amsStatus, hms } from "../client.js";

export const statusTools = [
  {
    name: "bambu_status",
    description:
      "Current printer state: gcode_state (IDLE/RUNNING/PAUSE/FINISH/FAILED), print progress percent, remaining minutes, current/total layers, and the running job name. Forces a fresh MQTT pushall.",
    inputSchema: z.object({}),
    handler: async () => {
      return status();
    },
  },
  {
    name: "bambu_temps",
    description:
      "Current and target temperatures in Celsius for nozzle, bed, and chamber.",
    inputSchema: z.object({}),
    handler: async () => {
      return temps();
    },
  },
  {
    name: "bambu_ams",
    description:
      "AMS state: each unit's humidity + temperature and every slot's filament type, color (hex), nozzle-temp range, and which slot is currently loaded. Slot numbers feed bambu_print_file's amsMapping.",
    inputSchema: z.object({}),
    handler: async () => {
      return amsStatus();
    },
  },
  {
    name: "bambu_hms",
    description:
      "Active HMS (Health Management System) entries, decoded to human-readable messages. Empty array means no faults/warnings.",
    inputSchema: z.object({}),
    handler: async () => {
      return { hms: await hms() };
    },
  },
  {
    name: "bambu_list_files",
    description:
      "List printable files on the printer's FTPS storage. Defaults to the cache root where uploads land.",
    inputSchema: z.object({
      dir: z
        .string()
        .optional()
        .describe("Absolute directory on the printer (default '/')"),
    }),
    handler: async (args: { dir?: string }) => {
      return { files: await listFiles(args.dir ?? "/") };
    },
  },
];
