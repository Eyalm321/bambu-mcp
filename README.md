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
export BAMBU_MODEL=p1s          # p1s | h2d — P2S uses the p1s dialect
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
        "BAMBU_MODEL": "p1s"
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
| `bambu_list_files` | read | files on printer FTPS storage |
| `bambu_upload` | write | push a sliced file over FTPS |
| `bambu_print_file` | write | start printing a file on the printer |
| `bambu_pause` / `bambu_resume` / `bambu_stop` | write | print control |

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

- **P2S schema**: `bambu-js` ships typed schemas for `p1s` / `h2d` only. P2S
  speaks the X1/P1-family MQTT dialect, so `BAMBU_MODEL=p1s` is the default and
  print commands are sent as raw payloads. The `project_file` start-print
  payload is the community LAN form — **verify against your actual P2S** before
  relying on unattended prints.
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
