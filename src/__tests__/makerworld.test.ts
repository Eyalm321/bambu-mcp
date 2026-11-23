import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { saveStream } from "../makerworld.js";

const bytes = () => Readable.from([Buffer.from("PK\x03\x04"), Buffer.from("rest")]);

describe("saveStream", () => {
  it("writes the file and leaves no temp file", async () => {
    const d = mkdtempSync(join(tmpdir(), "mw-"));
    const to = join(d, "a.3mf");
    expect(await saveStream(bytes(), to)).toBe(8);
    expect(readFileSync(to, "utf8")).toBe("PK\x03\x04rest");
    expect(readdirSync(d)).toEqual(["a.3mf"]);
  });

  it("rejects (no crash) when the directory does not exist", async () => {
    const d = mkdtempSync(join(tmpdir(), "mw-"));
    await expect(saveStream(bytes(), join(d, "missing", "a.3mf"))).rejects.toThrow(/ENOENT/);
  });

  it("rejects (no crash) when the directory is not writable", async () => {
    if (process.getuid?.() === 0) return; // root writes anywhere
    const d = mkdtempSync(join(tmpdir(), "mw-"));
    chmodSync(d, 0o500);
    try {
      await expect(saveStream(bytes(), join(d, "a.3mf"))).rejects.toThrow(/EACCES/);
    } finally {
      chmodSync(d, 0o700);
    }
  });

  it("is not blocked by a stale .part from an earlier run", async () => {
    const d = mkdtempSync(join(tmpdir(), "mw-"));
    const to = join(d, "a.3mf");
    writeFileSync(`${to}.part`, "stale");
    expect(await saveStream(bytes(), to)).toBe(8);
    expect(readFileSync(`${to}.part`, "utf8")).toBe("stale");
  });

  it("removes its temp file when the source fails midway", async () => {
    const d = mkdtempSync(join(tmpdir(), "mw-"));
    const to = join(d, "a.3mf");
    async function* failing() { yield Buffer.from("x"); throw new Error("socket reset"); }
    await expect(saveStream(failing(), to)).rejects.toThrow("socket reset");
    expect(readdirSync(d)).toEqual([]);
  });
});
