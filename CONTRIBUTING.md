# Contributing

Thanks for contributing to Heat Save Manager.

## Local Validation

Run this shortcut before opening a PR:

- `scripts\verify.cmd` (Windows)
- `./scripts/verify.ps1` (PowerShell)

Equivalent manual commands:

- `wails build -s -nopackage -nosyncgomod -m`
- `go test ./...`
- `npm run build --prefix frontend`

## Generated Files Guidance

- `frontend/wailsjs/` is intentionally ignored and should not be committed.
- If bindings are missing locally, regenerate them with `scripts\verify.cmd`.
- Prefer `-nosyncgomod -m` on Wails build commands to avoid unnecessary `go.mod` churn.
- CI enforces this policy by failing if `frontend/wailsjs/` is tracked or if checks leave the repo dirty.

## Commit Scope

- Keep commits focused (feature changes vs tooling/docs updates).
- Prefer separate commits when changing UI behavior and repository/tooling configuration.
- Do not include unrelated local environment changes in PRs.

## Automation

- Dependabot is enabled for Go modules, frontend npm deps, and GitHub Actions.
- PRs use `.github/pull_request_template.md` to enforce local validation and hygiene checks.
- Releases should follow `RELEASE_CHECKLIST.md`.
- GitHub release publishing runs `.github/workflows/release-assets.yml` to build and upload Windows release assets automatically.
- The release-assets workflow also supports manual reruns with `gh workflow run .github/workflows/release-assets.yml -f tag=vX.Y.Z`.
- If code-signing secrets are configured (`WINDOWS_CODESIGN_CERT_BASE64`, `WINDOWS_CODESIGN_PASSWORD`), release binaries are Authenticode-signed automatically.
- Release publishing uploads `.exe` and `.zip` assets, each with a `.sha256` checksum file for verification.
- For Defender false positives, follow `DEFENDER_SUBMISSION.md`.
- For Winget publication, generate manifests with `scripts/generate-winget-manifests.ps1` and follow `WINGET_RELEASE.md`.
