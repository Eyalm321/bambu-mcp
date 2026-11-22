import { describe, it, expect } from "vitest";
import { decodeSdcard, toEntries } from "../client.js";

describe("toEntries", () => {
  // Shape of a basic-ftp LIST parse from a P2S cache root: no MLSD, so no modifiedAt.
  const listing = [
    { name: "cube.3mf", size: 1_048_576, isDirectory: false, rawModifiedAt: "Nov 21 20:30" },
    { name: "plate_v10.gcode.3mf", size: 52_428_800, isDirectory: false, rawModifiedAt: "Nov 20 09:12" },
    { name: "timelapse", size: 4096, isDirectory: true, rawModifiedAt: "Oct 02 2025" },
    { name: "empty.3mf", size: 0, isDirectory: false, rawModifiedAt: "" },
  ];

  it("returns name, bytes, modified, dir per entry", () => {
    const { entries } = toEntries(listing);
    expect(entries[0]).toEqual({ name: "cube.3mf", bytes: 1_048_576, modified: "Nov 21 20:30", dir: false });
    expect(entries[2]).toEqual({ name: "timelapse", bytes: 4096, modified: "Oct 02 2025", dir: true });
  });

  it("sums file sizes only, not directories", () => {
    expect(toEntries(listing).totalBytes).toBe(1_048_576 + 52_428_800);
  });

  it("prefers a parsed modifiedAt as ISO time", () => {
    const at = new Date("2026-11-21T20:30:00Z");
    const { entries } = toEntries([{ name: "a", size: 1, isDirectory: false, modifiedAt: at, rawModifiedAt: "x" }]);
    expect(entries[0].modified).toBe("2026-11-21T20:30:00.000Z");
  });

  it("gives null modified when the server sends no date", () => {
    expect(toEntries(listing).entries[3].modified).toBeNull();
  });

  it("handles an empty directory", () => {
    expect(toEntries([])).toEqual({ entries: [], totalBytes: 0 });
  });
});

describe("decodeSdcard", () => {
  it.each([
    [0x0000, "absent"],
    [0x0100, "present"],
    [0x0200, "abnormal"],
    [0x0300, "readonly"],
  ] as const)("home_flag bits 8-9 = %i -> %s", (bits, state) => {
    // Other home_flag bits set around the SD bits must not leak in.
    const homeFlag = bits | 0x0000_04ff;
    expect(decodeSdcard({ home_flag: homeFlag, sdcard: true })).toEqual({
      state,
      raw: { sdcard: true, homeFlag },
    });
  });

  it("decodes a negative (signed 32-bit) home_flag", () => {
    expect(decodeSdcard({ home_flag: -2147483648 | 0x0100 }).state).toBe("present");
  });

  it("falls back to the sdcard boolean without home_flag", () => {
    expect(decodeSdcard({ sdcard: true })).toEqual({ state: "present", raw: { sdcard: true, homeFlag: null } });
    expect(decodeSdcard({ sdcard: false }).state).toBe("absent");
  });

  it("is unknown when the report has neither field", () => {
    expect(decodeSdcard({})).toEqual({ state: "unknown", raw: { sdcard: null, homeFlag: null } });
  });

  it("ignores a non-integer home_flag", () => {
    expect(decodeSdcard({ home_flag: "256", sdcard: false }).state).toBe("absent");
  });
});
