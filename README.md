# bambu-mcp

MCP server to drive a **Bambu Lab printer** (P2S / P1S / X1 family) in **LAN
mode** from an AI agent — Claude Code, Claude Desktop, any MCP client. Slice,
upload, print, and monitor over MQTT + FTPS.

Built on [`bambu-js`](https://www.npmjs.com/package/bambu-js) (MQTT control +
telemetry, FTPS file transfer). No official Bambu MCP exists — this is
community tooling on the same local API Home Assistant / OrcaSlicer use.

## Install

```bash
npm install -g bambu-mcp        # or: npx bambu-mcp
```

## Printer setup (one time)

On the printer screen: **Settings → LAN Mode → Enable**. Note the **IP**,
**Access Code**, and **Serial**.

## Configure — secrets via env, never on the command line

```bash
export BAMBU_IP=192.168.1.42
export BAMBU_ACCESS_CODE=xxxxxxxx
export BAMBU_SERIAL=01P00A1234567890
export BAMBU_MODEL=P1S          # P1S | H2D (case-insensitive) — P2S uses the P1S dialect
```

## Register with Claude Code

```bash
claude mcp add bambu -- \
  env BAMBU_IP=$BAMBU_IP BAMBU_ACCESS_CODE=$BAMBU_ACCESS_CODE \
      BAMBU_SERIAL=$BAMBU_SERIAL BAMBU_MODEL=$BAMBU_MODEL \
  npx bambu-mcp
```

Or in `~/.claude.json` / Claude Desktop config:

```json
{
  "mcpServers": {
    "bambu": {
      "command": "npx",
      "args": ["bambu-mcp"],
      "env": {
        "BAMBU_IP": "192.168.1.42",
        "BAMBU_ACCESS_CODE": "xxxxxxxx",
        "BAMBU_SERIAL": "01P00A1234567890",
        "BAMBU_MODEL": "P1S"
      }
    }
  }
}
```

## Tools

| tool | kind | does |
|------|------|------|
| `bambu_slice` | local | STL/STEP/3MF → printable .3mf (OrcaSlicer/Bambu Studio CLI) |
| `bambu_status` | read | gcode_state, progress %, remaining min, layer, job name |
| `bambu_temps` | read | nozzle / bed / chamber °C (current + target) |
| `bambu_ams` | read | AMS units + per-slot filament type, color, nozzle range, active slot |
| `bambu_hms` | read | active Health Management System faults, decoded to messages |
| `bambu_list_files` | read | files on printer FTPS storage |
| `bambu_upload` | write | push a sliced file over FTPS |
| `bambu_print_file` | write | start printing a file on the printer |
| `bambu_pause` / `bambu_resume` / `bambu_stop` | write | print control |
| `bambu_gcode` | write | run any raw G-code line (universal escape hatch) |
| `bambu_set_temps` | write | set nozzle / bed target °C |
| `bambu_home` | write | home all axes (G28) |
| `bambu_set_speed` | write | speed profile 1–4 (silent/standard/sport/ludicrous) |
| `bambu_light` | write | chamber light on / off / flashing |
| `bambu_snapshot` | camera | capture a camera JPEG to disk (see caveat) |
| `bambu_download_file` | file | download a file from the printer |
| `bambu_delete_file` | file | delete a file on the printer (permanent) |

`bambu_print_file` takes an optional `amsMapping` — an array mapping each
filament in the plate to a 0-based AMS slot (e.g. `[2]` prints from slot 2,
`[0,3]` maps filament 1→slot 0 and filament 2→slot 3). Read current slots with
`bambu_ams`.

## Typical AI flow

```
generate/pick STL
  → bambu_slice(inputPath, settings="printer.json;process.json")  →  out.3mf
  → bambu_upload(out.3mf)
  → bambu_print_file(remoteName)
  → poll bambu_status
```

## Slicing

`bambu_slice` wraps the OrcaSlicer / Bambu Studio CLI (shared PrusaSlicer-fork
flags). Binary auto-detected (`orca-slicer` on PATH, or
`~/Applications/{OrcaSlicer,BambuStudio}.AppImage`); override with `SLICER_BIN`.

A **bare STL** needs presets — export them once from the slicer
(Export → Export Config → printer + process JSON) and pass semicolon-joined via
`settings`. A **project `.3mf`** already embeds presets, so `settings` can be
omitted.

## Caveats

- **P2S schema**: `bambu-js` ships typed schemas for `P1S` / `H2D` only. The
  P2S speaks the P1S-family MQTT dialect — **verified live**: `bambu_status` /
  `bambu_temps` / `bambu_list_files` work against a real P2S with
  `BAMBU_MODEL=P1S`. Print commands are sent as raw payloads; the `project_file`
  start-print payload is the community LAN form and has **not** yet been
  confirmed on a P2S — verify before relying on unattended prints.
- **Camera**: `bambu_snapshot` uses the P1S TCP-JPEG protocol. It works on
  P1S/H2D but returns "invalid JPEG data" on a P2S (different camera protocol) —
  treat P2S camera capture as unsupported for now.
- **`bambu_gcode` / `bambu_home` / `bambu_set_temps`** send commands directly;
  don't run motion or homing mid-print. `bambu_gcode` is an unguarded escape
  hatch — it will run whatever G-code you give it.
- LAN mode only. No cloud account path (keeps it local + credential-light).
- `bambu_status` / `bambu_temps` force a full MQTT `pushall`, then read the
  freshest cached report (≤3 s wait).

## Develop

```bash
npm install
npm run build      # tsc → dist/ (ESM)
npm test           # vitest
```

## License

MIT
