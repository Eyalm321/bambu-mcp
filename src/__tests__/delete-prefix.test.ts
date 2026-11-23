import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../client.js", () => ({
  hms: vi.fn().mockResolvedValue([]),
  listFiles: vi.fn().mockResolvedValue({ files: [], entries: [], totalBytes: 31_400_000_000 }),
  uploadFile: vi.fn().mockResolvedValue(undefined),
  startPrint: vi.fn().mockResolvedValue(undefined),
  pausePrint: vi.fn(), resumePrint: vi.fn(), stopPrint: vi.fn(),
  downloadFile: vi.fn(), deleteFile: vi.fn().mockResolvedValue(undefined),
}));

import { deleteFile, uploadFile } from "../client.js";
import { checkDeleteName } from "../limits.js";
import { fileTools } from "../tools/files.js";
import { printTools } from "../tools/print.js";

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

describe("BAMBU_DELETE_PREFIX scopes uploads too (an overwrite destroys a file like a delete)", () => {
  const up = (remoteName?: string) =>
    tool(printTools, "bambu_upload").handler({ localPath: __filename, ...(remoteName === undefined ? {} : { remoteName }) });
  beforeEach(() => { vi.mocked(uploadFile).mockClear(); });
  afterEach(() => { delete process.env.BAMBU_DELETE_PREFIX; });

  it("unset: any name uploads (unchanged behaviour)", async () => {
    await up("ALEFBET.ISO");
    expect(uploadFile).toHaveBeenCalledWith(__filename, "ALEFBET.ISO");
  });

  it("set: a prefixed top-level name uploads", async () => {
    process.env.BAMBU_DELETE_PREFIX = "prints-";
    await expect(up("prints-cover.3mf")).resolves.toEqual({ uploaded: "prints-cover.3mf" });
  });

  it.each(["ALEFBET.ISO", "timelapse/x.mp4", "/prints-a.3mf", "prints-", "prints-a/../b"])(
    "set: refuses %j and uploads nothing",
    async (name) => {
      process.env.BAMBU_DELETE_PREFIX = "prints-";
      await expect(up(name)).rejects.toThrow(/can be uploaded/);
      expect(uploadFile).not.toHaveBeenCalled();
    },
  );

  it("set: the default name (local basename) must carry the prefix too", async () => {
    process.env.BAMBU_DELETE_PREFIX = "prints-";
    await expect(up()).rejects.toThrow(/BAMBU_DELETE_PREFIX/);
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
