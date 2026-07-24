import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs", async (orig) => {
  const actual = await orig<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn().mockReturnValue(true) };
});

vi.mock("../../client.js", () => ({
  uploadFile: vi.fn().mockResolvedValue(undefined),
  startPrint: vi.fn().mockResolvedValue(undefined),
  pausePrint: vi.fn().mockResolvedValue(undefined),
  resumePrint: vi.fn().mockResolvedValue(undefined),
  stopPrint: vi.fn().mockResolvedValue(undefined),
}));

import {
  uploadFile,
  startPrint,
  pausePrint,
  resumePrint,
  stopPrint,
} from "../../client.js";
import { printTools } from "../../tools/print.js";

const find = (n: string) => printTools.find((t: any) => t.name === n)!;

describe("printTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exports 5 tools with unique names", () => {
    expect(printTools).toHaveLength(5);
    const names = printTools.map((t: any) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("bambu_upload defaults remoteName to basename", async () => {
    await find("bambu_upload").handler({ localPath: "/tmp/model.3mf" });
    expect(uploadFile).toHaveBeenCalledWith("/tmp/model.3mf", "model.3mf");
  });

  it("bambu_upload honors an explicit remoteName", async () => {
    await find("bambu_upload").handler({
      localPath: "/tmp/model.3mf",
      remoteName: "job1.3mf",
    });
    expect(uploadFile).toHaveBeenCalledWith("/tmp/model.3mf", "job1.3mf");
  });

  it("bambu_print_file defaults plate=1, useAms=true, no mapping", async () => {
    await find("bambu_print_file").handler({ remoteName: "job1.3mf" });
    expect(startPrint).toHaveBeenCalledWith("job1.3mf", 1, true, undefined);
  });

  it("bambu_print_file passes explicit plate, useAms + amsMapping", async () => {
    await find("bambu_print_file").handler({
      remoteName: "job1.3mf",
      plate: 3,
      useAms: true,
      amsMapping: [2],
    });
    expect(startPrint).toHaveBeenCalledWith("job1.3mf", 3, true, [2]);
  });

  it("pause/resume/stop call the matching client fn", async () => {
    await find("bambu_pause").handler({});
    await find("bambu_resume").handler({});
    await find("bambu_stop").handler({});
    expect(pausePrint).toHaveBeenCalledOnce();
    expect(resumePrint).toHaveBeenCalledOnce();
    expect(stopPrint).toHaveBeenCalledOnce();
  });
});
