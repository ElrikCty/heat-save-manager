# Microsoft Defender Submission Playbook

Use this when a release binary is incorrectly flagged by Microsoft Defender or SmartScreen.

## 1) Gather release data

- Release page URL: `https://github.com/ElrikCty/heat-save-manager/releases/tag/vX.Y.Z`
- Executable URL: `https://github.com/ElrikCty/heat-save-manager/releases/download/vX.Y.Z/HeatSaveManager-vX.Y.Z-windows-x64.exe`
- SHA256 file URL: `https://github.com/ElrikCty/heat-save-manager/releases/download/vX.Y.Z/HeatSaveManager-vX.Y.Z-windows-x64.exe.sha256`

## 2) Verify checksum locally

```powershell
$version = "vX.Y.Z"
$file = "HeatSaveManager-$version-windows-x64.exe"
$expected = (Invoke-WebRequest -UseBasicParsing "https://github.com/ElrikCty/heat-save-manager/releases/download/$version/$file.sha256").Content.Split()[0].ToLower()
$actual = (Get-FileHash -Algorithm SHA256 ".\$file").Hash.ToLower()
"Expected: $expected"
"Actual:   $actual"
```

## 3) Submit to Microsoft

- Portal: `https://www.microsoft.com/en-us/wdsi/filesubmission`
- Category: software flagged incorrectly / false positive
- Include:
  - release URL
  - direct executable URL
  - checksum value
  - short behavior description (desktop save-profile manager for NFS Heat)

## 4) Track and close loop

- Save submission ID in release notes or issue tracker.
- Re-test on a clean Windows machine after Microsoft response.
- If fixed, add note in next release changelog.
