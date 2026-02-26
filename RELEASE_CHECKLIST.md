# Release Checklist

Use this checklist for every production release.

## 1) Prepare

- [ ] Sync branch and confirm a clean working tree (`git status`)
- [ ] Confirm target version (`vX.Y.Z`) and planned scope
- [ ] Optional: confirm code-signing secrets are configured in GitHub repo settings:
  - `WINDOWS_CODESIGN_CERT_BASE64`
  - `WINDOWS_CODESIGN_PASSWORD`
  - optional variable: `WINDOWS_CODESIGN_TIMESTAMP_URL`

## 2) Validate

- [ ] Run full local verification: `scripts\verify.cmd` (or `./scripts/verify.ps1`)
- [ ] Confirm no unintended generated churn or local-only artifacts
- [ ] Confirm `go.mod`/`go.sum` changes are intentional (if present)

## 3) Finalize

- [ ] Merge release-ready changes to `main`
- [ ] Create and push annotated tag: `git tag -a vX.Y.Z -m "vX.Y.Z"` then `git push origin vX.Y.Z`

## 4) Publish

- [ ] Draft release notes (highlights, fixes, breaking changes if any)
  - helper: `scripts\generate-release-notes.cmd -Tag vX.Y.Z`
- [ ] Publish the GitHub release (workflow auto-builds and uploads Windows asset)
- [ ] Verify `Release Assets` workflow completed successfully
- [ ] If no release-triggered run appears, manually dispatch it:
  - `gh workflow run .github/workflows/release-assets.yml -f tag=vX.Y.Z`
- [ ] Verify release page includes `HeatSaveManager-vX.Y.Z-windows-x64.exe`
- [ ] Verify release page includes `HeatSaveManager-vX.Y.Z-windows-x64-installer.exe`
- [ ] Verify release page includes `HeatSaveManager-vX.Y.Z-windows-x64.zip`
- [ ] Verify release page includes `HeatSaveManager-vX.Y.Z-windows-x64.exe.sha256`
- [ ] Verify release page includes `HeatSaveManager-vX.Y.Z-windows-x64-installer.exe.sha256`
- [ ] Verify release page includes `HeatSaveManager-vX.Y.Z-windows-x64.zip.sha256`
- [ ] Verify download link works

## 5) Post-release

- [ ] Smoke test the released build on target platform
- [ ] If flagged, submit to Microsoft Defender using `DEFENDER_SUBMISSION.md`
- [ ] Generate Winget manifests: `./scripts/generate-winget-manifests.ps1 -Tag vX.Y.Z`
- [ ] Open/refresh PR on `microsoft/winget-pkgs`
- [ ] Create follow-up issues for anything deferred
