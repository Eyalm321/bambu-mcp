# Changelog

## Unreleased

### Security
- While `BAMBU_MAX_NOZZLE_C` / `BAMBU_MAX_BED_C` is set, `bambu_gcode` also caps the heater targets of `M303` (PID autotune; `E-1` is the bed), `G10` and `M568` (`S` / `R` tool temperatures), and refuses `M141` / `M191` (chamber) unless every target is 0. Unset, nothing changes.

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
