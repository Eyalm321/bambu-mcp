"""
bambu-mcp — MCP server that drives a Bambu Lab P2S in LAN mode.

Auth comes from env (never args, never chat):
    BAMBU_IP           printer LAN IP        e.g. 192.168.1.42
    BAMBU_ACCESS_CODE  LAN access code       (printer screen: Settings > LAN)
    BAMBU_SERIAL       printer serial        e.g. 01P00A1234567890

Transport: MQTT (commands + telemetry) on the printer, FTPS for file upload.
All handled by the `bambulabs_api` package.

Slicing is NOT done here. Feed this server a pre-sliced .3mf/.gcode
(OrcaSlicer / Bambu Studio, or their CLI). See README.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from functools import lru_cache
from typing import Any

from mcp.server.fastmcp import FastMCP

try:
    import bambulabs_api as bl
except ImportError as e:  # pragma: no cover
    raise SystemExit(
        "bambulabs-api not installed. Run: pip install bambulabs-api"
    ) from e

mcp = FastMCP("bambu-p2s")


# --------------------------------------------------------------------------- #
# Connection (one lazy, cached printer session)
# --------------------------------------------------------------------------- #
def _env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        raise RuntimeError(
            f"{name} not set. Export BAMBU_IP, BAMBU_ACCESS_CODE, BAMBU_SERIAL."
        )
    return val


@lru_cache(maxsize=1)
def printer() -> "bl.Printer":
    """Connect once, reuse. MQTT session persists across tool calls."""
    p = bl.Printer(_env("BAMBU_IP"), _env("BAMBU_ACCESS_CODE"), _env("BAMBU_SERIAL"))
    p.connect()
    return p


def _call(name: str, *args: Any, **kwargs: Any) -> Any:
    """Call a printer method by name, erroring clearly if the lib renamed it."""
    fn = getattr(printer(), name, None)
    if fn is None:
        raise RuntimeError(
            f"bambulabs_api has no '{name}' on this version. "
            "Pin bambulabs-api>=2.5 or check dir(printer())."
        )
    return fn(*args, **kwargs)


# --------------------------------------------------------------------------- #
# Slicing (OrcaSlicer / Bambu Studio CLI — same PrusaSlicer-fork flags)
# --------------------------------------------------------------------------- #
_SLICER_CANDIDATES = (
    "orca-slicer",
    "orcaslicer",
    "OrcaSlicer",
    "bambu-studio",
    os.path.expanduser("~/Applications/OrcaSlicer.AppImage"),
    os.path.expanduser("~/Applications/BambuStudio.AppImage"),
)


def _slicer_bin() -> str:
    """Resolve the slicer binary: $SLICER_BIN, else first candidate found."""
    env = os.environ.get("SLICER_BIN")
    if env:
        return env
    for c in _SLICER_CANDIDATES:
        found = shutil.which(c) or (c if os.path.isfile(c) else None)
        if found:
            return found
    raise RuntimeError(
        "No slicer found. Set SLICER_BIN to orca-slicer / BambuStudio.AppImage."
    )


@mcp.tool()
def slice(
    input_path: str,
    output_3mf: str = "",
    plate: int = 0,
    settings: str = "",
    filaments: str = "",
    arrange: bool = True,
    orient: bool = True,
) -> dict:
    """
    Slice an STL/STEP/3MF into a printable .3mf via OrcaSlicer/Bambu Studio CLI.

    input_path: model on THIS machine (.stl/.step/.3mf).
    output_3mf: output path (default: <input>.sliced.3mf next to input).
    plate:      0 = all plates, i = plate i.
    settings:   semicolon-joined preset JSONs (printer;process). Needed for a
                bare STL — export these from the slicer (Export → Export Config).
                A project .3mf already embeds presets, so this can be empty.
    filaments:  semicolon-joined filament JSON(s).
    arrange/orient: auto-place + auto-orient before slicing.

    Returns {output, cmd}. Chain: slice -> upload -> print_file.
    """
    if not os.path.isfile(input_path):
        raise RuntimeError(f"No such file: {input_path}")
    out = output_3mf or os.path.splitext(input_path)[0] + ".sliced.3mf"

    cmd = [_slicer_bin(), "--slice", str(plate)]
    if settings:
        cmd += ["--load-settings", settings]
    if filaments:
        cmd += ["--load-filaments", filaments]
    cmd += ["--arrange", "1" if arrange else "0"]
    cmd += ["--orient", "1" if orient else "0"]
    cmd += ["--export-3mf", out, input_path]

    proc = subprocess.run(
        cmd, capture_output=True, text=True, timeout=1800  # 30 min hard cap
    )
    if proc.returncode != 0 or not os.path.isfile(out):
        raise RuntimeError(
            f"Slice failed (exit {proc.returncode}).\n"
            f"stdout: {proc.stdout[-1500:]}\nstderr: {proc.stderr[-1500:]}"
        )
    return {"output": out, "cmd": " ".join(cmd)}


# --------------------------------------------------------------------------- #
# Read-only tools
# --------------------------------------------------------------------------- #
@mcp.tool()
def status() -> dict:
    """Current printer state, print progress %, and remaining time."""
    return {
        "state": str(_call("get_state")),
        "percent": _call("get_percentage"),
        "remaining_min": _call("get_time"),
    }


@mcp.tool()
def temps() -> dict:
    """Nozzle and bed temperatures (current, in Celsius)."""
    return {
        "nozzle_c": _call("get_nozzle_temperature"),
        "bed_c": _call("get_bed_temperature"),
    }


@mcp.tool()
def list_files() -> list[str]:
    """List printable files on the printer's storage (FTPS root cache dir)."""
    ftp = printer().ftp_client
    # list_directory returns (files, dirs) or similar per bambulabs_api 2.6.x
    result = ftp.list_directory()
    if isinstance(result, tuple):
        files = result[0]
    else:
        files = result
    return list(files)


# --------------------------------------------------------------------------- #
# Mutating tools (actual print control) — named actions only
# --------------------------------------------------------------------------- #
@mcp.tool()
def upload(local_path: str, remote_name: str = "") -> dict:
    """
    Upload a sliced .3mf/.gcode from disk to the printer over FTPS.

    local_path: path to the sliced file on THIS machine.
    remote_name: name on the printer (defaults to the local basename).
    """
    if not os.path.isfile(local_path):
        raise RuntimeError(f"No such file: {local_path}")
    name = remote_name or os.path.basename(local_path)
    with open(local_path, "rb") as fh:
        _call("upload_file", fh, name)
    return {"uploaded": name}


@mcp.tool()
def print_file(remote_name: str, plate: int = 1, use_ams: bool = True) -> dict:
    """
    Start printing a file already on the printer.

    remote_name: filename on the printer (upload() first, or list_files()).
    plate: plate number inside a multi-plate .3mf (1-based).
    use_ams: pull filament from AMS if present.
    """
    _call("start_print", remote_name, plate, use_ams=use_ams)
    return {"printing": remote_name, "plate": plate}


@mcp.tool()
def pause() -> dict:
    """Pause the running print."""
    _call("pause_print")
    return {"ok": "paused"}


@mcp.tool()
def resume() -> dict:
    """Resume a paused print."""
    _call("resume_print")
    return {"ok": "resumed"}


@mcp.tool()
def stop() -> dict:
    """Stop/cancel the running print. Not resumable."""
    _call("stop_print")
    return {"ok": "stopped"}


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
