import { describe, it, expect } from "vitest";
import { printCommand } from "../client.js";

const p = (name: string, o = {}) => printCommand(name, o).print as Record<string, unknown>;

describe("printCommand (Bambu Studio's LAN project_file)", () => {
  it("defaults to Studio's prep: calibrations on auto, no vibration test, layer inspect on", () => {
    const c = p("prints-cover.gcode.3mf");
    expect(c).toMatchObject({
      command: "project_file",
      param: "Metadata/plate_1.gcode",
      url: "ftp://prints-cover.gcode.3mf",
      file: "prints-cover.gcode.3mf",
      md5: "from_sd_card",
      subtask_name: "prints-cover",
      auto_bed_leveling: 2,
      extrude_cali_flag: 2,
      nozzle_offset_cali: 2,
      extrude_cali_manual_mode: 0,
      vibration_cali: false,
      layer_inspect: true,
      timelapse: false,
      bed_type: "auto",
      cfg: "0",
      use_ams: true,
      ams_mapping: [0],
      ams_mapping2: [{ ams_id: 0, slot_id: 0 }],
    });
  });

  it("keeps the booleans true on auto for firmware that reads only them", () => {
    const c = p("a.3mf");
    expect(c.bed_leveling).toBe(true);
    expect(c.flow_cali).toBe(true);
  });

  it("maps on/off to 1/0 and the booleans", () => {
    const c = p("a.3mf", { bedLeveling: "off", flowCali: "on", nozzleOffsetCali: "off" });
    expect(c).toMatchObject({ bed_leveling: false, auto_bed_leveling: 0, flow_cali: true, extrude_cali_flag: 1, nozzle_offset_cali: 0 });
  });

  it("passes the other overrides", () => {
    const c = p("a.3mf", { plate: 3, vibrationCali: true, layerInspect: false, timelapse: true, bedType: "textured_plate" });
    expect(c).toMatchObject({ param: "Metadata/plate_3.gcode", vibration_cali: true, layer_inspect: false, timelapse: true, bed_type: "textured_plate" });
  });

  it("builds ams_mapping2 from trays (ams_id*4 + slot), 255 = unmapped", () => {
    const c = p("a.3mf", { amsMapping: [0, 5, 255] });
    expect(c.ams_mapping).toEqual([0, 5, 255]);
    expect(c.ams_mapping2).toEqual([{ ams_id: 0, slot_id: 0 }, { ams_id: 1, slot_id: 1 }, { ams_id: 255, slot_id: 255 }]);
  });

  it("sends no AMS mapping without the AMS", () => {
    const c = p("a.3mf", { useAms: false, amsMapping: [2] });
    expect(c).toMatchObject({ use_ams: false, ams_mapping: [255], ams_mapping2: [] });
  });

  it("never sends the old forced calibration set or a hex md5", () => {
    const c = p("a.3mf");
    expect(c.vibration_cali).not.toBe(true);
    expect(c.md5).not.toMatch(/^[0-9a-f]{32}$/i);
    expect(c.auto_bed_leveling).not.toBe(1);
  });
});
