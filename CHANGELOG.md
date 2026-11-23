# Changelog

## Unreleased

### Security
- While `BAMBU_MAX_NOZZLE_C` / `BAMBU_MAX_BED_C` is set, `bambu_gcode` also caps the heater targets of `M303` (PID autotune; `E-1` is the bed), `G10` and `M568` (`S` / `R` tool temperatures), and refuses `M141` / `M191` (chamber) unless every target is 0. Unset, nothing changes.
- While a cap is set, `bambu_gcode` also refuses `M303` that picks its heater with `H`, and `M143` (a heater's maximum temperature).
- `BAMBU_DELETE_PREFIX` now scopes `bambu_upload` too: with it set, an upload may write only a top-level name with the prefix, since an upload over another file destroys it just as a delete would. Unset, nothing changes.

### Changed
- `bambu_print_file` sends Bambu Studio's LAN print prep instead of forcing calibrations: bed leveling, flow and nozzle offset calibration on auto (the integer fields newer firmware such as the P2S reads, which it treated as missing and so calibrated every print), no vibration test, first-layer inspection on, `md5` and `url` as Studio sends them, plus `ams_mapping2`. New optional overrides: `bedLeveling`, `flowCali`, `nozzleOffsetCali` (`auto`/`on`/`off`), `vibrationCali`, `layerInspect`, `timelapse`, `bedType`. Firmware that reads only the old booleans keeps bed leveling and flow calibration on, as before.

## 0.4.1 (2026-11-22)

### Added
- `BAMBU_DELETE_PREFIX`: when set, `bambu_delete_file` deletes only a top-level file whose name starts with it, so a deployment can allow an agent to remove its own uploads without allowing any delete. Unset, nothing changes.
- `bambu_upload` and `bambu_print_file` refuse to start while the printer reports HMS 0500-0100-0003-0004 (SD card full), saying how much the top-level files use, instead of sending a job that fails in prep. A failed health read does not block.
- MakerWorld tools (#24): `makerworld_search` (keyword search, no login), `makerworld_get_design` (a design's print profiles: instanceId, print time, grams, filaments, AMS need; no login) and `makerworld_download` (one profile's 3MF project to a local path; needs a one-time Bambu account login). The download is an unsliced project: slice it with `bambu_slice`, then `bambu_upload` + `bambu_print_file`.
- `scripts/cloud-login.mjs`: the one-time Bambu account login for `makerworld_download`. It logs in with a code Bambu emails (no password is asked for, plus an authenticator code for 2FA accounts) and writes only the token, mode 600, to `~/.config/bambu-mcp/cloud.env` (or `BAMBU_CLOUD_TOKEN_FILE`). The script ships in the npm package: `node node_modules/bambu-mcp/scripts/cloud-login.mjs`.

## 0.4.0 (2026-11-22)

### Added
- `bambu_list_files` returns `entries` (name, size in bytes, modified time, dir flag) and `totalBytes` for the listed directory beside `files`, which stays a list of names so existing callers keep working (#20).
- `bambu_status` returns `sdcard`: `state` (`present` / `absent` / `abnormal` / `readonly` / `unknown`) decoded from `home_flag` bits 8-9, or from the `sdcard` flag on firmware without them, with both raw values beside it (#20).
- `bambu_status` returns `storage`: `sdcard` and `internal`, each `{freeKb, totalKb}` or null, read from `device.cam.tl_external_*_kb` / `tl_internal_*_kb` (the fields BambuStudio reads); `storage` is null when the firmware sends neither (#20). `bambu_list_files` does not report free space.
- Optional deployment limits, all env vars (#17): `BAMBU_PATH_ROOT` confines every local path (upload, download, snapshot, slice input/output/presets; symlinks followed), `BAMBU_DISABLED_TOOLS` leaves the named tools unregistered, `BAMBU_MAX_NOZZLE_C` / `BAMBU_MAX_BED_C` cap `bambu_set_temps` and the temperature commands in `bambu_gcode`. Unset, nothing changes.

## 0.3.1 (2026-11-16)

### Security
- `hono` 4.13.14 → 4.13.16 and `@hono/node-server` 1.19.17 → 2.1.6. Both come in through `@modelcontextprotocol/sdk`, whose declared range for `@hono/node-server` (`^1.19.9 || ^2.0.5`) includes 2.x, so the 1.19.17 override is removed. This clears the remaining moderate advisories in the SDK's HTTP transport (which this stdio server never loads anyway). `npm audit --omit=dev` now reports 0 vulnerabilities.

## 0.3.0 (2026-11-15)

### Breaking
- **Requires Node.js 22 or later** (`engines: >=22`). Node 20 reached end of life in April 2026. CI tests Node 22 and 24 (#10).

### Security and dependencies
- `@modelcontextprotocol/sdk` 1.29.0 → 1.32.2, `zod` → 4.6.7.
- `basic-ftp` 6.2.4, which fixes three advisories in the FTP client used for printer file access.
- `npm audit`: 0 critical, 0 high. The remaining moderates are in the SDK's HTTP transport, which this stdio server never loads.
- Every dependency version is at least 14 days old (#1).

### Maintenance
- Dependabot with a 14-day cooldown (#1).
- npm publishing uses trusted publishing (OIDC). Workflow actions are pinned to commit SHAs (#9).
- `@types/node` now tracks Node 22 (#10).

## Earlier versions

See the [GitHub releases](https://github.com/Eyalm321/bambu-mcp/releases).
