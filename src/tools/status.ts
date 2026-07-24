import { z } from "zod";
import { status, temps, listFiles } from "../client.js";

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
