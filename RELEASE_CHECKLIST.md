# Release Checklist

Use this checklist for every production release.

## 1) Prepare

- [ ] Sync branch and confirm a clean working tree (`git status`)
- [ ] Confirm target version (`vX.Y.Z`) and planned scope

## 2) Validate

- [ ] Run full local verification: `scripts\verify.cmd` (or `./scripts/verify.ps1`)
- [ ] Confirm no unintended generated churn or local-only artifacts
- [ ] Confirm `go.mod`/`go.sum` changes are intentional (if present)

## 3) Finalize

- [ ] Merge release-ready changes to `main`
- [ ] Create and push annotated tag: `git tag -a vX.Y.Z -m "vX.Y.Z"` then `git push origin vX.Y.Z`

## 4) Publish

- [ ] Draft release notes (highlights, fixes, breaking changes if any)
- [ ] Publish the GitHub release (workflow auto-builds and uploads Windows asset)
- [ ] Verify `Release Assets` workflow completed successfully
- [ ] Verify release page includes `HeatSaveManager-vX.Y.Z-windows-x64.zip`
- [ ] Verify download link works

## 5) Post-release

- [ ] Smoke test the released build on target platform
- [ ] Create follow-up issues for anything deferred
