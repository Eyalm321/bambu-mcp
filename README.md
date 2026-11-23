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

## Deployment limits (optional)

Server-side limits that hold whatever the client's own permission rules allow. All are env vars, unset = no limit.

| Variable | Effect |
|---|---|
| `BAMBU_PATH_ROOT` | Local paths for `bambu_upload`, `bambu_download_file`, `bambu_snapshot` and `bambu_slice` (input, output and preset files) must resolve, symlinks followed, inside this directory; others are refused. Snapshots default into it. |
| `BAMBU_DISABLED_TOOLS` | Comma list of tool names that are not registered at all, e.g. `bambu_gcode,bambu_delete_file`. |
| `BAMBU_MAX_NOZZLE_C`, `BAMBU_MAX_BED_C` | `bambu_set_temps` refuses targets above the cap. `bambu_gcode` applies the same caps to `M104`/`M109` (nozzle) and `M140`/`M190` (bed), to every `S`, `R` and `B` target, and refuses a preheat preset pick (`I`). It also caps the other commands that heat to a target in the line: `M303` PID autotune (`E0`+ nozzle, `E-1` bed, any other heater refused) and the `G10`/`M568` tool-temperature forms (`S`, `R`); while a cap is set, chamber `M141`/`M191` is refused unless it turns the heater off (`S0`). A cap that is not a number refuses every temperature command; while a cap is set, a temperature command whose value is not a plain number is refused. The caps cover these direct-command tools only, not the G-code inside a print file (`bambu_upload` + `bambu_print_file`). |
| `BAMBU_DELETE_PREFIX` | `bambu_delete_file` deletes only a top-level file whose name starts with this prefix (no `/`, `\` or `..`), e.g. `prints-` so an agent can clean up its own uploads and nothing else. A prefix that is itself a path refuses every delete. Unset, any file can be deleted. |

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
| `bambu_status` | read | gcode_state, progress %, remaining min, layer, job name, SD card state, free/total storage (when reported) |
| `bambu_temps` | read | nozzle / bed / chamber °C (current + target) |
| `bambu_ams` | read | AMS units + per-slot filament type, color, nozzle range, active slot |
| `bambu_hms` | read | active Health Management System faults, decoded to messages |
| `bambu_list_files` | read | files on printer FTPS storage: names, plus size in bytes and modified time per entry and the directory's total bytes |
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
| `makerworld_search` | makerworld | search MakerWorld models by keyword (no login) |
| `makerworld_get_design` | makerworld | a design's print profiles: instanceId, time, grams, filaments, AMS (no login) |
| `makerworld_download` | makerworld | download one profile's 3MF project (needs the MakerWorld login below) |

`bambu_print_file` takes an optional `amsMapping` — an array mapping each
filament in the plate to a 0-based AMS slot (e.g. `[2]` prints from slot 2,
`[0,3]` maps filament 1→slot 0 and filament 2→slot 3). Read current slots with
`bambu_ams`.

`bambu_print_file` sends the print prep Bambu Studio sends for a LAN print: bed leveling, flow
calibration and nozzle offset calibration on `"auto"` (the printer decides whether it needs them), no
vibration test, first-layer inspection on, no timelapse. Override each with `bedLeveling`, `flowCali`,
`nozzleOffsetCali` (`"auto"`, `"on"` or `"off"`), `vibrationCali`, `layerInspect`, `timelapse` and
`bedType`.

## MakerWorld (optional)

MakerWorld has no official API; these tools use the endpoints its web app uses. Search and profile
reads need nothing. A download needs a Bambu account token, made once on this machine's terminal
(it asks for the email, then the login code Bambu emails, plus an authenticator code if the account
has 2FA; no password is asked for. It writes only the token, mode 600, to `~/.config/bambu-mcp/cloud.env`, or `BAMBU_CLOUD_TOKEN_FILE`):

```bash
node scripts/cloud-login.mjs
```

The token is sent only as request headers to makerworld.com and is never returned or logged; rerun
the login when a download says the token expired. A downloaded 3MF is a project, not sliced G-code:
`bambu_slice` it, then `bambu_upload` + `bambu_print_file`. Personal use, one profile per call; each
model's license applies.

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
  don't run motion or homing mid-print. `bambu_gcode` is an escape hatch: apart
  from the temperature caps above it runs whatever G-code you give it, so
  disable it with `BAMBU_DISABLED_TOOLS` where that matters.
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
