import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../client.js", () => ({
  status: vi.fn().mockResolvedValue({ state: "IDLE" }),
  temps: vi.fn().mockResolvedValue({ nozzleC: 25 }),
  listFiles: vi.fn().mockResolvedValue(["a.3mf", "b.3mf"]),
  amsStatus: vi.fn().mockResolvedValue({ units: [], activeSlot: null }),
}));

import { status, temps, listFiles, amsStatus } from "../../client.js";
import { statusTools } from "../../tools/status.js";

const find = (n: string) => statusTools.find((t: any) => t.name === n)!;

describe("statusTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exports 4 tools with unique names", () => {
    expect(statusTools).toHaveLength(4);
    const names = statusTools.map((t: any) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every tool has description + input schema", () => {
    for (const t of statusTools) {
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeDefined();
    }
  });

  it("bambu_status calls client.status", async () => {
    await find("bambu_status").handler({});
    expect(status).toHaveBeenCalledOnce();
  });

  it("bambu_temps calls client.temps", async () => {
    await find("bambu_temps").handler({});
    expect(temps).toHaveBeenCalledOnce();
  });

  it("bambu_ams calls client.amsStatus", async () => {
    await find("bambu_ams").handler({});
    expect(amsStatus).toHaveBeenCalledOnce();
  });

  it("bambu_list_files defaults dir to '/'", async () => {
    await find("bambu_list_files").handler({});
    expect(listFiles).toHaveBeenCalledWith("/");
  });

  it("bambu_list_files passes a custom dir", async () => {
    await find("bambu_list_files").handler({ dir: "/cache" });
    expect(listFiles).toHaveBeenCalledWith("/cache");
  });
});
