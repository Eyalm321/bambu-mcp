import { z } from "zod";
import { join } from "node:path";
import {
  runGcode,
  setTemps,
  home,
  setLight,
  setSpeed,
  snapshot,
} from "../client.js";

export const controlTools = [
  {
    name: "bambu_gcode",
    description:
      "Send a raw G-code line to the printer (universal escape hatch: movement, extrusion, fans, temps, etc.). Multiple lines may be separated by newlines. Use with care while a print is running.",
    inputSchema: z.object({
      line: z.string().describe("G-code, e.g. 'G28' or 'M106 S255'"),
    }),
    handler: async (args: { line: string }) => {
      await runGcode(args.line);
      return { sent: args.line };
    },
  },
  {
    name: "bambu_set_temps",
    description:
      "Set target temperatures in Celsius. Provide nozzleC and/or bedC. Set to 0 to turn a heater off.",
    inputSchema: z.object({
      nozzleC: z.number().optional().describe("Nozzle target °C"),
      bedC: z.number().optional().describe("Bed target °C"),
    }),
    handler: async (args: { nozzleC?: number; bedC?: number }) => {
      await setTemps(args.nozzleC, args.bedC);
      return { nozzleC: args.nozzleC ?? null, bedC: args.bedC ?? null };
    },
  },
  {
    name: "bambu_home",
    description: "Home all axes (G28). Do not run mid-print.",
    inputSchema: z.object({}),
    handler: async () => {
      await home();
      return { ok: "homing" };
    },
  },
  {
    name: "bambu_light",
    description: "Control the chamber light.",
    inputSchema: z.object({
      mode: z.enum(["on", "off", "flashing"]).describe("Light mode"),
    }),
    handler: async (args: { mode: "on" | "off" | "flashing" }) => {
      await setLight(args.mode);
      return { light: args.mode };
    },
  },
  {
    name: "bambu_set_speed",
    description:
      "Set the print speed profile: 1 silent, 2 standard, 3 sport, 4 ludicrous.",
    inputSchema: z.object({
      level: z
        .number()
        .int()
        .min(1)
        .max(4)
        .describe("1 silent, 2 standard, 3 sport, 4 ludicrous"),
    }),
    handler: async (args: { level: number }) => {
      await setSpeed(args.level as 1 | 2 | 3 | 4);
      return { speed: args.level };
    },
  },
  {
    name: "bambu_snapshot",
    description:
      "Capture a single camera frame (JPEG) and write it to disk. Returns the file path and byte size.",
    inputSchema: z.object({
      outputPath: z
        .string()
        .optional()
        .describe("Where to save the JPEG (default: ./bambu-snapshot-<ts>.jpg)"),
    }),
    handler: async (args: { outputPath?: string }) => {
      const out =
        args.outputPath ?? join(process.cwd(), `bambu-snapshot-${Date.now()}.jpg`);
      return snapshot(out);
    },
  },
];
