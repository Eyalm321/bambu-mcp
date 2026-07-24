# bambu-mcp

MCP server to drive a **Bambu Lab P2S** in **LAN mode** from an AI agent
(Claude Code, Claude Desktop, any MCP client). Wraps
[`bambulabs-api`](https://pypi.org/project/bambulabs-api/) (MQTT for
commands/telemetry + FTPS for file upload).

No official Bambu MCP exists — this is community tooling built on the same
local API that Home Assistant / OrcaSlicer use.

## Slicing

Now built in via the `slice` tool — wraps the OrcaSlicer / Bambu Studio CLI
(same PrusaSlicer-fork flags). Binary auto-detected; override with `SLICER_BIN`:

```bash
export SLICER_BIN=~/Applications/BambuStudio.AppImage   # or orca-slicer
```

A **bare STL** needs presets — export them once from the slicer
(Export → Export Config → printer + process JSON) and pass via `settings`
(semicolon-joined). A **project `.3mf`** already embeds presets, so `settings`
can be empty.

## Printer setup (one time)

On the P2S touchscreen: **Settings → LAN Mode → Enable**. Note three things:

- IP address
- Access Code (shown on the LAN screen)
- Serial number

## Install

```bash
cd ~/dev/bambu-mcp
pip install -e .
```

## Configure (secrets via env — never on the command line history)

```bash
export BAMBU_IP=192.168.1.42
export BAMBU_ACCESS_CODE=xxxxxxxx
export BAMBU_SERIAL=01P00A1234567890
```

## Register with Claude Code

```bash
claude mcp add bambu-p2s -- \
  env BAMBU_IP=$BAMBU_IP BAMBU_ACCESS_CODE=$BAMBU_ACCESS_CODE BAMBU_SERIAL=$BAMBU_SERIAL \
  bambu-mcp
```

(Or put the same under `mcpServers` in `~/.claude.json` / Claude Desktop config.)

## Tools

| tool | kind | does |
|------|------|------|
| `slice` | local | STL/STEP/3MF → printable .3mf (OrcaSlicer/Bambu CLI) |
| `status` | read | state, progress %, remaining min |
| `temps` | read | nozzle + bed °C |
| `list_files` | read | files on printer storage |
| `upload` | write | push a sliced file over FTPS |
| `print_file` | write | start printing a file on the printer |
| `pause` / `resume` / `stop` | write | print control |

## Typical AI flow

```
generate/pick STL
   → slice(input_path, settings="printer.json;process.json")  →  out.3mf
   → upload(out.3mf)
   → print_file(remote_name)  →  poll status()
```

## Notes / caveats

- `bambulabs-api` method names drift between versions. `server.py` calls them
  by name via a small shim and errors clearly if one is missing —
  `pip show bambulabs-api` and check `dir(Printer(...))` if a tool 500s.
- LAN mode only. Cloud control is possible with the same lib but needs Bambu
  account creds; not wired here on purpose (keeps it local + credential-light).
- P2S is CoreXY w/ AMS support — `print_file(use_ams=True)` by default.
