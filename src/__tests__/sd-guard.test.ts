import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../client.js", () => ({
  hms: vi.fn().mockResolvedValue([]),
  listFiles: vi.fn().mockResolvedValue({ files: [], entries: [], totalBytes: 31_400_000_000 }),
  uploadFile: vi.fn().mockResolvedValue(undefined),
  startPrint: vi.fn().mockResolvedValue(undefined),
  pausePrint: vi.fn(), resumePrint: vi.fn(), stopPrint: vi.fn(),
  downloadFile: vi.fn(), deleteFile: vi.fn().mockResolvedValue(undefined),
}));

import { hms, listFiles, uploadFile, startPrint } from "../client.js";
import { SD_FULL_HMS } from "../sdguard.js";
import { printTools } from "../tools/print.js";

const tool = (list: any[], n: string) => list.find((t) => t.name === n)!;

describe("SD-full guard", () => {
  const upload = () => tool(printTools, "bambu_upload").handler({ localPath: __filename, remoteName: "prints-x.3mf" });
  const print = () => tool(printTools, "bambu_print_file").handler({ remoteName: "prints-x.3mf" });
  beforeEach(() => { vi.mocked(uploadFile).mockClear(); vi.mocked(startPrint).mockClear(); vi.mocked(hms).mockResolvedValue([]); });

  it("passes when no SD-full code is active", async () => {
    vi.mocked(hms).mockResolvedValue([{ code: "0300-0100-0001-0003", message: "x" }]);
    await upload();
    await print();
    expect(uploadFile).toHaveBeenCalledOnce();
    expect(startPrint).toHaveBeenCalledOnce();
  });

  it("refuses upload and print while the SD card is full, with the space used", async () => {
    vi.mocked(hms).mockResolvedValue([{ code: SD_FULL_HMS, message: "Not enough space in SD Card." }]);
    await expect(upload()).rejects.toThrow(/upload.*SD card is full.*31400\.0 MB/);
    await expect(print()).rejects.toThrow(/print.*SD card is full/);
    expect(uploadFile).not.toHaveBeenCalled();
    expect(startPrint).not.toHaveBeenCalled();
  });

  it("still refuses when the listing fails", async () => {
    vi.mocked(hms).mockResolvedValue([{ code: SD_FULL_HMS, message: "" }]);
    vi.mocked(listFiles).mockRejectedValueOnce(new Error("ftp down"));
    await expect(print()).rejects.toThrow(/SD card is full/);
  });

  it("a failed health read does not block", async () => {
    vi.mocked(hms).mockRejectedValue(new Error("mqtt timeout"));
    await print();
    expect(startPrint).toHaveBeenCalledOnce();
  });
});
