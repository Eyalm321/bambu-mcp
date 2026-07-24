import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../client.js", () => ({
  runGcode: vi.fn().mockResolvedValue(undefined),
  setTemps: vi.fn().mockResolvedValue(undefined),
  home: vi.fn().mockResolvedValue(undefined),
  setLight: vi.fn().mockResolvedValue(undefined),
  setSpeed: vi.fn().mockResolvedValue(undefined),
  snapshot: vi.fn().mockResolvedValue({ path: "/tmp/x.jpg", bytes: 100 }),
}));

import {
  runGcode,
  setTemps,
  home,
  setLight,
  setSpeed,
  snapshot,
} from "../../client.js";
import { controlTools } from "../../tools/control.js";

const find = (n: string) => controlTools.find((t: any) => t.name === n)!;

describe("controlTools", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exports 6 tools with unique names", () => {
    expect(controlTools).toHaveLength(6);
    const names = controlTools.map((t: any) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("bambu_gcode passes the line through", async () => {
    await find("bambu_gcode").handler({ line: "G28" });
    expect(runGcode).toHaveBeenCalledWith("G28");
  });

  it("bambu_set_temps forwards nozzle + bed", async () => {
    await find("bambu_set_temps").handler({ nozzleC: 220, bedC: 60 });
    expect(setTemps).toHaveBeenCalledWith(220, 60);
  });

  it("bambu_home calls home", async () => {
    await find("bambu_home").handler({});
    expect(home).toHaveBeenCalledOnce();
  });

  it("bambu_light forwards the mode", async () => {
    await find("bambu_light").handler({ mode: "on" });
    expect(setLight).toHaveBeenCalledWith("on");
  });

  it("bambu_set_speed forwards the level", async () => {
    await find("bambu_set_speed").handler({ level: 3 });
    expect(setSpeed).toHaveBeenCalledWith(3);
  });

  it("bambu_snapshot uses given path", async () => {
    await find("bambu_snapshot").handler({ outputPath: "/tmp/shot.jpg" });
    expect(snapshot).toHaveBeenCalledWith("/tmp/shot.jpg");
  });
});
