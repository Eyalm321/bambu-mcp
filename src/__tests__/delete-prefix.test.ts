import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../client.js", () => ({
  hms: vi.fn().mockResolvedValue([]),
  listFiles: vi.fn().mockResolvedValue({ files: [], entries: [], totalBytes: 31_400_000_000 }),
  uploadFile: vi.fn().mockResolvedValue(undefined),
  startPrint: vi.fn().mockResolvedValue(undefined),
  pausePrint: vi.fn(), resumePrint: vi.fn(), stopPrint: vi.fn(),
  downloadFile: vi.fn(), deleteFile: vi.fn().mockResolvedValue(undefined),
}));

import { deleteFile } from "../client.js";
import { checkDeleteName } from "../limits.js";
import { fileTools } from "../tools/files.js";

const tool = (list: any[], n: string) => list.find((t) => t.name === n)!;
const del = (remoteName: string) => tool(fileTools, "bambu_delete_file").handler({ remoteName });

describe("BAMBU_DELETE_PREFIX", () => {
  beforeEach(() => { vi.mocked(deleteFile).mockClear(); });
  afterEach(() => { delete process.env.BAMBU_DELETE_PREFIX; });

  it("unset: any name is allowed (unchanged behaviour)", async () => {
    expect(checkDeleteName("timelapse/video.mp4")).toBe("timelapse/video.mp4");
    await del("/anything.3mf");
    expect(deleteFile).toHaveBeenCalledWith("/anything.3mf");
  });

  it("set: a top-level name with the prefix is deleted", async () => {
    process.env.BAMBU_DELETE_PREFIX = "prints-";
    await del("prints-cover.3mf");
    expect(deleteFile).toHaveBeenCalledWith("prints-cover.3mf");
  });

  it.each([
    "cover.3mf",          // no prefix
    "prints-",            // the prefix alone
    "/prints-cover.3mf",  // a path
    "prints-a/../b.3mf",  // traversal
    "dir/prints-a.3mf",   // subdirectory
    "prints-a\\b.3mf",    // backslash
    "prints-..3mf",       // '..'
    "prints-a\n.3mf",     // control char
    "Prints-a.3mf",       // case differs
  ])("set: refuses %j and deletes nothing", async (name) => {
    process.env.BAMBU_DELETE_PREFIX = "prints-";
    await expect(del(name)).rejects.toThrow(/BAMBU_DELETE_PREFIX/);
    expect(deleteFile).not.toHaveBeenCalled();
  });

  it("a prefix that is a path refuses every delete", async () => {
    process.env.BAMBU_DELETE_PREFIX = "../";
    await expect(del("../x")).rejects.toThrow(/plain name prefix/);
    expect(deleteFile).not.toHaveBeenCalled();
  });
});
