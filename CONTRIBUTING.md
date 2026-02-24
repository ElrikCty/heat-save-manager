# Contributing

Thanks for contributing to Heat Save Manager.

## Local Validation

Run these checks before opening a PR:

- `go test ./...`
- `npm run build --prefix frontend`

## Generated Files Guidance

- `wails build` can regenerate files under `frontend/wailsjs/`.
- Commit regenerated files only when there is a real API surface change between Go bindings and frontend usage.
- If generated files changed only by ordering/format churn, discard them before committing.

## Commit Scope

- Keep commits focused (feature changes vs generated output vs docs).
- Prefer separate commits when changing UI behavior and repository/tooling configuration.
- Do not include unrelated local environment changes in PRs.
