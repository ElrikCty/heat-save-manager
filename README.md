<h1 align="center">Heat Save Manager</h1>

<p align="center">
  A safer desktop manager for Need for Speed Heat save profiles on Windows.
</p>

<p align="center">
  <a href="https://github.com/ElrikCty/heat-save-manager/releases/latest"><img alt="Latest Release" src="https://img.shields.io/github/v/release/ElrikCty/heat-save-manager?sort=semver"></a>
  <a href="https://github.com/ElrikCty/heat-save-manager/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/ElrikCty/heat-save-manager/ci.yml?branch=main&label=ci"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/ElrikCty/heat-save-manager"></a>
</p>

<p align="center">
  <a href="https://github.com/ElrikCty/heat-save-manager/releases/latest">Download Latest Release</a>
  ·
  <a href="#install">Install</a>
  ·
  <a href="#development">Development</a>
  ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

Heat Save Manager helps you switch, back up, and organize NFS Heat saves with guardrails: profile checks, backup/rollback behavior, startup diagnostics, and guided quick actions.

## Contents

- [Why this project](#why-this-project)
- [Features](#features)
- [Install](#install)
- [Verify integrity (SHA256)](#verify-integrity-sha256)
- [Settings](#settings)
- [Development](#development)
- [Release and distribution docs](#release-and-distribution-docs)
- [Repository hygiene](#repository-hygiene)

## Why this project

- Prevent accidental save loss during profile switching
- Keep profile setup simple (`Profiles/<name>` + active marker)
- Surface setup issues quickly with diagnostics and one-click actions
- Notify users when a newer app release is available

## Features

- Profile switching with backup and rollback safety
- Create, rename, delete profiles (active-profile deletion blocked)
- Active marker management via `active_profile.txt`
- Start New Save with optional preserve-current flow
- Startup diagnostics and remediation quick actions
- In-app update banner with release/download links

## Install

### Option 1: Download from Releases

- Open: `https://github.com/ElrikCty/heat-save-manager/releases/latest`
- Assets include:
  - `HeatSaveManager-vX.Y.Z-windows-x64.exe`
  - `HeatSaveManager-vX.Y.Z-windows-x64.zip`
  - matching `.sha256` files

> [!NOTE]
> If Windows SmartScreen warns on first run, click `More info` then `Run anyway`.

### Option 2: Winget (after package publication)

- `winget install --id ElrikCty.HeatSaveManager`

## Verify integrity (SHA256)

```powershell
$version = "vX.Y.Z"
$file = "HeatSaveManager-$version-windows-x64.exe"
$expected = (Invoke-WebRequest -UseBasicParsing "https://github.com/ElrikCty/heat-save-manager/releases/download/$version/$file.sha256").Content.Split()[0].ToLower()
$actual = (Get-FileHash -Algorithm SHA256 ".\$file").Hash.ToLower()
if ($expected -eq $actual) { "OK: checksum matches" } else { "ERROR: checksum mismatch" }
```

## Settings

- SaveGame path is auto-discovered, with manual override support
- Custom path is persisted across launches
- Config file location: `%AppData%/HeatSaveManager/config.json`
- Manual path must point to the `SaveGame` directory

## Tech stack

- Go
- Wails v2
- React + TypeScript + Vite

## Development

- Fast local verification (bindings + frontend build + backend tests): `scripts\verify.cmd`
- PowerShell variant: `./scripts/verify.ps1`
- Run app in development mode: `wails dev`
- Build distributable app: `wails build`
- Validate frontend changes: `npm run build --prefix frontend`
- Validate backend changes: `go test ./...`

Maintainer helpers:

- Release notes helper: `scripts\generate-release-notes.cmd -Tag vX.Y.Z`
- Winget manifests helper: `scripts\generate-winget-manifests.cmd -Tag vX.Y.Z`

## Release and distribution docs

- `RELEASE_CHECKLIST.md`
- `RELEASE_NOTES_TEMPLATE.md`
- `DEFENDER_SUBMISSION.md`
- `WINGET_RELEASE.md`
- `WINGET_PR_TEMPLATE.md`

## Repository hygiene

- `frontend/wailsjs/` is generated and intentionally ignored
- Prefer `wails build -nosyncgomod -m` for binding refresh
- CI enforces clean-tree and generated-file policy

## Contributing

See `CONTRIBUTING.md` for branch, PR, and validation expectations.
