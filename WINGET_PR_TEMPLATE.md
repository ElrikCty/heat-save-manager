# Winget PR Template

Use this when opening the PR to `microsoft/winget-pkgs`.

## Suggested PR title

`Add ElrikCty.HeatSaveManager version <X.Y.Z>`

## Suggested PR body

```markdown
## Summary
- Add `ElrikCty.HeatSaveManager` version `<X.Y.Z>` manifests.
- Installer source: `https://github.com/ElrikCty/heat-save-manager/releases/download/v<X.Y.Z>/HeatSaveManager-v<X.Y.Z>-windows-x64-installer.exe`
- Manifest targets the standard NSIS installer (not the portable executable).

## Files
- `manifests/e/ElrikCty/HeatSaveManager/<X.Y.Z>/ElrikCty.HeatSaveManager.yaml`
- `manifests/e/ElrikCty/HeatSaveManager/<X.Y.Z>/ElrikCty.HeatSaveManager.installer.yaml`
- `manifests/e/ElrikCty/HeatSaveManager/<X.Y.Z>/ElrikCty.HeatSaveManager.locale.en-US.yaml`
```

## Current release shortcut (v1.0.3)

- Title: `Add ElrikCty.HeatSaveManager version 1.0.3`
- Release URL: `https://github.com/ElrikCty/heat-save-manager/releases/tag/v1.0.3`
