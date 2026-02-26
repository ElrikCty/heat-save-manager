# Release Notes Template

Use this when publishing a new GitHub release.

## Highlights

- <short bullet>
- <short bullet>

## What's changed

- <PR title> by @<author> in <PR link>
- <PR title> by @<author> in <PR link>

Full Changelog: https://github.com/ElrikCty/heat-save-manager/compare/<previous_tag>...<new_tag>

## Verification

- Windows executable: `HeatSaveManager-vX.Y.Z-windows-x64.exe`
- Windows installer: `HeatSaveManager-vX.Y.Z-windows-x64-installer.exe`
- Windows zip: `HeatSaveManager-vX.Y.Z-windows-x64.zip`
- Checksums:
  - `HeatSaveManager-vX.Y.Z-windows-x64.exe.sha256`
  - `HeatSaveManager-vX.Y.Z-windows-x64-installer.exe.sha256`
  - `HeatSaveManager-vX.Y.Z-windows-x64.zip.sha256`

### Verify SHA256 (PowerShell)

```powershell
$version = "vX.Y.Z"
$file = "HeatSaveManager-$version-windows-x64.exe"
$expected = (Invoke-WebRequest -UseBasicParsing "https://github.com/ElrikCty/heat-save-manager/releases/download/$version/$file.sha256").Content.Split()[0].ToLower()
$actual = (Get-FileHash -Algorithm SHA256 ".\$file").Hash.ToLower()
if ($expected -eq $actual) { "OK: checksum matches" } else { "ERROR: checksum mismatch" }
```

## Defender / SmartScreen Note

- If Windows flags the new release unexpectedly, submit the release URL and executable to Microsoft Security Intelligence for review:
  - `https://www.microsoft.com/en-us/wdsi/filesubmission`

## Winget

- After release publish, generate manifests:

```powershell
./scripts/generate-winget-manifests.ps1 -Tag vX.Y.Z
```

- Open/update PR in `microsoft/winget-pkgs` with generated manifests under `dist/winget/manifests/...`.
