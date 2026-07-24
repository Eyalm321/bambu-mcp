import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("node:fs", async (orig) => {
  const actual = await orig<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn().mockReturnValue(true) };
});

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { sliceTools, resolveSlicerBin } from "../../tools/slice.js";

const find = (n: string) => sliceTools.find((t: any) => t.name === n)!;

/** Fake child that succeeds on next tick. */
function fakeChild(exitCode = 0) {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  setImmediate(() => child.emit("close", exitCode));
  return child;
}

describe("sliceTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SLICER_BIN = "/opt/orca-slicer";
    spawnMock.mockReturnValue(fakeChild(0));
  });

  it("exports 1 tool named bambu_slice", () => {
    expect(sliceTools).toHaveLength(1);
    expect(sliceTools[0].name).toBe("bambu_slice");
  });

  it("resolveSlicerBin honors SLICER_BIN", () => {
    expect(resolveSlicerBin()).toBe("/opt/orca-slicer");
  });

  it("builds correct CLI args and default output path", async () => {
    const res = await find("bambu_slice").handler({ inputPath: "/tmp/part.stl" });
    expect(res.output).toBe("/tmp/part.sliced.3mf");
    const [bin, args] = spawnMock.mock.calls[0];
    expect(bin).toBe("/opt/orca-slicer");
    expect(args).toEqual([
      "--slice",
      "0",
      "--arrange",
      "1",
      "--orient",
      "1",
      "--export-3mf",
      "/tmp/part.sliced.3mf",
      "/tmp/part.stl",
    ]);
  });

  it("passes settings, filaments, plate and toggles", async () => {
    await find("bambu_slice").handler({
      inputPath: "/tmp/part.stl",
      plate: 2,
      settings: "printer.json;process.json",
      filaments: "pla.json",
      arrange: false,
      orient: false,
    });
    const [, args] = spawnMock.mock.calls[0];
    expect(args).toContain("--load-settings");
    expect(args).toContain("printer.json;process.json");
    expect(args).toContain("--load-filaments");
    expect(args).toContain("pla.json");
    expect(args.slice(0, 2)).toEqual(["--slice", "2"]);
    expect(args).toContain("0"); // arrange/orient disabled
  });

  it("rejects when the slicer exits non-zero", async () => {
    spawnMock.mockReturnValue(fakeChild(1));
    await expect(
      find("bambu_slice").handler({ inputPath: "/tmp/part.stl" })
    ).rejects.toThrow(/Slice failed/);
  });
});
