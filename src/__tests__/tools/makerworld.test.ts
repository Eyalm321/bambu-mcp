import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../makerworld.js", async (orig) => {
  const real: any = await orig();
  return { ...real, mwJson: vi.fn(), downloadTo: vi.fn().mockResolvedValue(1234) };
});

import { mwJson, downloadTo, designId, cloudToken } from "../../makerworld.js";
import { makerworldTools, safeName } from "../../tools/makerworld.js";

const tool = (n: string) => makerworldTools.find((t) => t.name === n)!;
let dir: string;

describe("makerworld tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dir = mkdtempSync(join(tmpdir(), "mw-"));
    delete process.env.BAMBU_PATH_ROOT;
    delete process.env.BAMBU_CLOUD_TOKEN;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("designId takes ids and model URLs, refuses anything else", () => {
    expect(designId(1929633)).toBe(1929633);
    expect(designId("1929633")).toBe(1929633);
    expect(designId("https://makerworld.com/en/models/1929633-p2s-camera-privacy-cover#profileId-2071320")).toBe(1929633);
    expect(designId("https://makerworld.com/models/42")).toBe(42);
    for (const bad of ["", "abc", "https://evil.example/models/1", "1929633; rm"]) expect(() => designId(bad), bad).toThrow();
  });

  it("search and get_design need no token", async () => {
    vi.mocked(mwJson).mockResolvedValueOnce({ total: 1, hits: [{ id: 7, title: "T", designCreator: { name: "C" } }] });
    const s: any = await tool("makerworld_search").handler({ keyword: "cover" });
    expect(mwJson).toHaveBeenCalledWith("/api/v1/search-service/select/design2", { keyword: "cover", limit: 10, offset: 0 });
    expect(s.designs[0]).toMatchObject({ designId: 7, title: "T", creator: "C" });
    vi.mocked(mwJson).mockResolvedValueOnce({ id: 7, title: "T", instances: [{ id: 9, title: "P", prediction: 1580, weight: 5, needAms: false, instanceFilaments: [{ type: "PLA", color: "#000000", usedG: "5" }] }] });
    const d: any = await tool("makerworld_get_design").handler({ design: "7" });
    expect(vi.mocked(mwJson).mock.calls[1]).toEqual(["/api/v1/design-service/design/7"]);
    expect(d.profiles[0]).toMatchObject({ instanceId: 9, printMinutes: 26, grams: 5, filaments: [{ type: "PLA", grams: 5 }] });
  });

  it("download asks with auth, writes a safe name, never overwrites", async () => {
    process.chdir(dir);
    vi.mocked(mwJson).mockResolvedValue({ name: "../../etc/cover.3mf", url: "https://files.example/x" });
    const r: any = await tool("makerworld_download").handler({ instanceId: 9 });
    expect(mwJson).toHaveBeenCalledWith("/api/v1/design-service/instance/9/f3mf", { type: "download" }, true);
    expect(r.downloaded).toBe(join(process.cwd(), "cover.3mf"));
    expect(downloadTo).toHaveBeenCalledWith("https://files.example/x", join(process.cwd(), "cover.3mf"));
    writeFileSync(join(dir, "taken.3mf"), "x");
    await expect(tool("makerworld_download").handler({ instanceId: 9, localPath: join(dir, "taken.3mf") })).rejects.toThrow(/already exists/);
  });

  it("download obeys BAMBU_PATH_ROOT", async () => {
    process.env.BAMBU_PATH_ROOT = dir;
    vi.mocked(mwJson).mockResolvedValue({ name: "a.3mf", url: "https://files.example/x" });
    await expect(tool("makerworld_download").handler({ instanceId: 9, localPath: join(tmpdir(), "outside.3mf") })).rejects.toThrow(/outside BAMBU_PATH_ROOT/);
    expect(downloadTo).not.toHaveBeenCalled();
  });

  it("safeName keeps a plain basename ending in .3mf", () => {
    expect(safeName("Cover v2.3mf", "f")).toBe("Cover v2.3mf");
    expect(safeName("../x/..hidden", "f")).toBe("hidden.3mf");
    expect(safeName(undefined, "makerworld-9")).toBe("makerworld-9.3mf");
    expect(safeName("a$(b).3mf", "f")).toBe("a_b_.3mf");
  });

  it("token comes from BAMBU_CLOUD_TOKEN, else the env file", () => {
    const f = join(dir, "cloud.env");
    process.env.BAMBU_CLOUD_TOKEN_FILE = f;
    expect(cloudToken()).toBeUndefined();
    writeFileSync(f, "# comment\nBAMBU_CLOUD_TOKEN=abc.def\n");
    expect(cloudToken()).toBe("abc.def");
    process.env.BAMBU_CLOUD_TOKEN = "fromenv";
    expect(cloudToken()).toBe("fromenv");
    delete process.env.BAMBU_CLOUD_TOKEN_FILE;
  });
});
