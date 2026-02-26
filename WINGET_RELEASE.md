# Winget Release Flow

This repository can generate Winget manifests from a published GitHub release.

## Prerequisites

- A published release tag like `v1.0.3`
- Release assets present:
  - `HeatSaveManager-vX.Y.Z-windows-x64.exe`
  - `HeatSaveManager-vX.Y.Z-windows-x64.exe.sha256`

## Generate manifests

```powershell
./scripts/generate-winget-manifests.ps1 -Tag vX.Y.Z
```

Windows shortcut:

```bat
scripts\generate-winget-manifests.cmd -Tag vX.Y.Z
```

Generated files are written under:

- `dist/winget/manifests/e/ElrikCty/HeatSaveManager/X.Y.Z/`

## Submit to winget-pkgs

1. Fork `microsoft/winget-pkgs`
2. Copy generated manifest folder into the same path structure in your fork
3. Open a PR to `microsoft/winget-pkgs`
4. Address Winget validation bot comments if any

## User install command (after merge)

```powershell
winget install --id ElrikCty.HeatSaveManager
```
