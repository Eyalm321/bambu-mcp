import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../client.js", () => ({
  downloadFile: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
}));

import { downloadFile, deleteFile } from "../../client.js";
import { fileTools } from "../../tools/files.js";

const find = (n: string) => fileTools.find((t: any) => t.name === n)!;

describe("fileTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exports 2 tools with unique names", () => {
    expect(fileTools).toHaveLength(2);
    const names = fileTools.map((t: any) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("bambu_download_file forwards remote + local", async () => {
    await find("bambu_download_file").handler({
      remoteName: "job.3mf",
      localPath: "/tmp/job.3mf",
    });
    expect(downloadFile).toHaveBeenCalledWith("job.3mf", "/tmp/job.3mf");
  });

  it("bambu_delete_file forwards the name", async () => {
    await find("bambu_delete_file").handler({ remoteName: "old.3mf" });
    expect(deleteFile).toHaveBeenCalledWith("old.3mf");
  });
});
