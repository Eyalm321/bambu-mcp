import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../client.js", () => ({
  runGcode: vi.fn().mockResolvedValue(undefined),
  setTemps: vi.fn().mockResolvedValue(undefined),
  home: vi.fn(), setLight: vi.fn(), setSpeed: vi.fn(),
  snapshot: vi.fn().mockResolvedValue({ path: "x", bytes: 1 }),
  downloadFile: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn(),
  uploadFile: vi.fn().mockResolvedValue(undefined),
  startPrint: vi.fn(), pausePrint: vi.fn(), resumePrint: vi.fn(), stopPrint: vi.fn(),
}));

import { runGcode, setTemps, snapshot, downloadFile, uploadFile } from "../client.js";
import { checkPath, checkTemps, checkGcodeTemps, enabledTools } from "../limits.js";
import { controlTools } from "../tools/control.js";
import { fileTools } from "../tools/files.js";
import { printTools } from "../tools/print.js";
import { sliceTools } from "../tools/slice.js";

const tool = (list: any[], n: string) => list.find((t) => t.name === n)!;
const ENV = ["BAMBU_PATH_ROOT", "BAMBU_DISABLED_TOOLS", "BAMBU_MAX_NOZZLE_C", "BAMBU_MAX_BED_C"];

let root: string, outside: string;
beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV) delete process.env[k];
  const base = realpathSync(mkdtempSync(join(tmpdir(), "bambu-limits-")));
  root = join(base, "root"); outside = join(base, "outside");
  mkdirSync(root); mkdirSync(outside);
  writeFileSync(join(root, "model.stl"), "x");
  writeFileSync(join(outside, "secret.stl"), "x");
});
afterEach(() => { for (const k of ENV) delete process.env[k]; });

describe("BAMBU_PATH_ROOT", () => {
  it("unset: paths pass through unchanged", () => {
    expect(checkPath("/anywhere/x.3mf", "write")).toBe("/anywhere/x.3mf");
  });

  it("allows reads and new writes inside the root", () => {
    process.env.BAMBU_PATH_ROOT = root;
    expect(checkPath(join(root, "model.stl"), "read")).toBe(join(root, "model.stl"));
    expect(checkPath(join(root, "new.3mf"), "write")).toBe(join(root, "new.3mf"));
  });

  it("refuses paths outside, via .. and via a symlink", () => {
    process.env.BAMBU_PATH_ROOT = root;
    expect(() => checkPath(join(outside, "secret.stl"), "read")).toThrow(/outside BAMBU_PATH_ROOT/);
    expect(() => checkPath(join(root, "..", "outside", "secret.stl"), "read")).toThrow(/outside/);
    symlinkSync(join(outside, "secret.stl"), join(root, "link.stl"));
    expect(() => checkPath(join(root, "link.stl"), "read")).toThrow(/outside/);
    expect(() => checkPath(join(root, "link.stl"), "write")).toThrow(/outside/);
    symlinkSync(outside, join(root, "dirlink"));
    expect(() => checkPath(join(root, "dirlink", "new.3mf"), "write")).toThrow(/outside/);
  });

  it("refuses a write into a missing directory", () => {
    process.env.BAMBU_PATH_ROOT = root;
    expect(() => checkPath(join(root, "nope", "x.3mf"), "write")).toThrow(/No such directory/);
  });

  it("tools refuse before touching the printer or slicer", async () => {
    process.env.BAMBU_PATH_ROOT = root;
    await expect(tool(fileTools, "bambu_download_file").handler({ remoteName: "a.3mf", localPath: join(outside, "a.3mf") })).rejects.toThrow(/outside/);
    expect(downloadFile).not.toHaveBeenCalled();
    await expect(tool(printTools, "bambu_upload").handler({ localPath: join(outside, "secret.stl") })).rejects.toThrow(/outside/);
    expect(uploadFile).not.toHaveBeenCalled();
    await expect(tool(controlTools, "bambu_snapshot").handler({ outputPath: join(outside, "s.jpg") })).rejects.toThrow(/outside/);
    expect(snapshot).not.toHaveBeenCalled();
    await expect(tool(sliceTools, "bambu_slice").handler({ inputPath: join(outside, "secret.stl") })).rejects.toThrow(/outside/);
    await expect(tool(sliceTools, "bambu_slice").handler({ inputPath: join(root, "model.stl"), outputPath: join(outside, "o.3mf") })).rejects.toThrow(/outside/);
    await expect(tool(sliceTools, "bambu_slice").handler({ inputPath: join(root, "model.stl"), settings: `${join(root, "model.stl")};${join(outside, "secret.stl")}` })).rejects.toThrow(/outside/);
  });

  it("snapshot defaults into the root", async () => {
    process.env.BAMBU_PATH_ROOT = root;
    await tool(controlTools, "bambu_snapshot").handler({});
    expect((snapshot as any).mock.calls[0][0].startsWith(root + "/")).toBe(true);
  });
});

describe("BAMBU_DISABLED_TOOLS", () => {
  it("drops the named tools and warns on unknown names", () => {
    process.env.BAMBU_DISABLED_TOOLS = " bambu_gcode,bambu_stop , nope";
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const names = enabledTools([...controlTools, ...printTools]).map((t) => t.name);
    expect(names).not.toContain("bambu_gcode");
    expect(names).not.toContain("bambu_stop");
    expect(names).toContain("bambu_home");
    expect(err).toHaveBeenCalledWith("BAMBU_DISABLED_TOOLS: no tool named nope");
    err.mockRestore();
  });
});

describe("temperature caps", () => {
  beforeEach(() => { process.env.BAMBU_MAX_NOZZLE_C = "280"; process.env.BAMBU_MAX_BED_C = "100"; });

  it("set_temps refuses above a cap and sends nothing", async () => {
    await expect(tool(controlTools, "bambu_set_temps").handler({ nozzleC: 300 })).rejects.toThrow(/BAMBU_MAX_NOZZLE_C/);
    await expect(tool(controlTools, "bambu_set_temps").handler({ nozzleC: 200, bedC: 110 })).rejects.toThrow(/BAMBU_MAX_BED_C/);
    expect(setTemps).not.toHaveBeenCalled();
    await tool(controlTools, "bambu_set_temps").handler({ nozzleC: 280, bedC: 100 });
    expect(setTemps).toHaveBeenCalledWith(280, 100);
  });

  it("gcode temperature commands obey the same caps", async () => {
    for (const g of ["M104 S300", "m104s300", "N12 M109 R290", "G28\nM140 S120", "M190 S101 ; bed"]) {
      await expect(tool(controlTools, "bambu_gcode").handler({ line: g })).rejects.toThrow(/Refused/);
    }
    expect(runGcode).not.toHaveBeenCalled();
    for (const g of ["M104 S250", "; M104 S999", "M1040 S999", "M106 S255", "M140 S0"]) {
      await tool(controlTools, "bambu_gcode").handler({ line: g });
    }
    expect(runGcode).toHaveBeenCalledTimes(5);
  });

  it("gcode temperature commands in any spelling are checked, odd values refused", () => {
    for (const g of [
      "M104 S+300", "M140 S+150", "M0104 S300", "m00140 s120", "M104 S3e2",
      "G28\rM104 S300", "G90\rM190 S150", "G28 M104 S300", "M104 S200 M140 S120",
      "M104 S-5", "M104 S", "M104 S(300)", "M104 S300*45", "M 104 S300", "m  0140 s120",
      "M104 S200 B300", "M109 B300", "M104 B+300", "M104 I1", "M140 I0", "m190 i2", "M109 S200 I1",
    ]) {
      expect(() => checkGcodeTemps(g), g).toThrow(/Refused/);
    }
    for (const g of ["M104 S250", "M0104 S250", "G28 M140 S90", "M104 S200.5 T0", "N3 M109 R250*12", "M1040 S999", "M 104 S250", "M 1040 S999", "M104 S200 B250", "G2 X10 I5"]) {
      expect(() => checkGcodeTemps(g), g).not.toThrow();
    }
  });

  it("a cap that is not a number fails closed", () => {
    process.env.BAMBU_MAX_NOZZLE_C = "28O";
    expect(() => checkTemps(100)).toThrow(/not a number/);
    expect(() => checkGcodeTemps("M104 S100")).toThrow(/not a number/);
  });

  it("no caps set: anything goes", () => {
    delete process.env.BAMBU_MAX_NOZZLE_C; delete process.env.BAMBU_MAX_BED_C;
    expect(() => checkTemps(400, 150)).not.toThrow();
  });
});
