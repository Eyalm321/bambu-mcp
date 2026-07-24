import { z } from "zod";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import {
  uploadFile,
  startPrint,
  pausePrint,
  resumePrint,
  stopPrint,
} from "../client.js";

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
      if (!existsSync(args.localPath)) {
        throw new Error(`No such file: ${args.localPath}`);
      }
      const remote = args.remoteName ?? basename(args.localPath);
      await uploadFile(args.localPath, remote);
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
        .array(z.number().int())
        .optional()
        .describe(
          "Map each filament in the plate to an AMS slot (0-based), e.g. [2] prints from slot 2, [0,3] maps filament 1→slot 0, filament 2→slot 3. See bambu_ams. Default [0]."
        ),
    }),
    handler: async (args: {
      remoteName: string;
      plate?: number;
      useAms?: boolean;
      amsMapping?: number[];
    }) => {
      await startPrint(
        args.remoteName,
        args.plate ?? 1,
        args.useAms ?? true,
        args.amsMapping
      );
      return {
        printing: args.remoteName,
        plate: args.plate ?? 1,
        amsMapping: args.amsMapping ?? [0],
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
