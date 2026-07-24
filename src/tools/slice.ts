import { z } from "zod";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { delimiter, join } from "node:path";

/** True if a bare command name is found on $PATH. */
function isOnPath(cmd: string): boolean {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const exts = platform() === "win32" ? ["", ".exe", ".bat", ".cmd"] : [""];
  return dirs.some((d) => exts.some((ext) => existsSync(join(d, cmd + ext))));
}

/**
 * Resolve the slicer binary: $SLICER_BIN, else the first candidate that exists.
 * OrcaSlicer and Bambu Studio share the same PrusaSlicer-fork CLI flags.
 */
const SLICER_CANDIDATES = [
  "orca-slicer",
  "orcaslicer",
  "OrcaSlicer",
  "bambu-studio",
  join(homedir(), "Applications/OrcaSlicer.AppImage"),
  join(homedir(), "Applications/BambuStudio.AppImage"),
];

export function resolveSlicerBin(): string {
  const fromEnv = process.env.SLICER_BIN;
  if (fromEnv) return fromEnv;
  for (const c of SLICER_CANDIDATES) {
    // Absolute-path candidates must exist on disk; bare names must be on $PATH.
    if (c.includes("/")) {
      if (existsSync(c)) return c;
    } else if (isOnPath(c)) {
      return c;
    }
  }
  throw new Error(
    "No slicer found. Set SLICER_BIN to orca-slicer or a BambuStudio.AppImage path."
  );
}

function run(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Slice timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`Slice failed (exit ${code}). ${err.slice(-1500)}`));
    });
  });
}

export const sliceTools = [
  {
    name: "bambu_slice",
    description:
      "Slice an STL/STEP/3MF into a printable .3mf via the OrcaSlicer / Bambu Studio CLI. A bare STL needs presets — export them from the slicer (Export Config) and pass via `settings` (semicolon-joined printer;process JSONs). A project .3mf already embeds presets. Returns the output path to hand to bambu_upload.",
    inputSchema: z.object({
      inputPath: z.string().describe("Model on this machine (.stl/.step/.3mf)"),
      outputPath: z
        .string()
        .optional()
        .describe("Output .3mf path (default: <input>.sliced.3mf)"),
      plate: z
        .number()
        .int()
        .optional()
        .describe("0 = all plates, i = plate i (default 0)"),
      settings: z
        .string()
        .optional()
        .describe("Semicolon-joined preset JSONs, e.g. 'printer.json;process.json'"),
      filaments: z
        .string()
        .optional()
        .describe("Semicolon-joined filament preset JSON(s)"),
      arrange: z.boolean().optional().describe("Auto-arrange (default true)"),
      orient: z.boolean().optional().describe("Auto-orient (default true)"),
    }),
    handler: async (args: {
      inputPath: string;
      outputPath?: string;
      plate?: number;
      settings?: string;
      filaments?: string;
      arrange?: boolean;
      orient?: boolean;
    }) => {
      if (!existsSync(args.inputPath)) {
        throw new Error(`No such file: ${args.inputPath}`);
      }
      const out =
        args.outputPath ?? args.inputPath.replace(/\.[^.]+$/, "") + ".sliced.3mf";
      const bin = resolveSlicerBin();
      const cliArgs = ["--slice", String(args.plate ?? 0)];
      if (args.settings) cliArgs.push("--load-settings", args.settings);
      if (args.filaments) cliArgs.push("--load-filaments", args.filaments);
      cliArgs.push("--arrange", args.arrange === false ? "0" : "1");
      cliArgs.push("--orient", args.orient === false ? "0" : "1");
      cliArgs.push("--export-3mf", out, args.inputPath);

      await run(bin, cliArgs, 1_800_000); // 30 min hard cap
      if (!existsSync(out)) {
        throw new Error(`Slice reported success but ${out} was not created`);
      }
      return { output: out, cmd: [bin, ...cliArgs].join(" ") };
    },
  },
];
