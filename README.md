# Heat Save Manager

Desktop app to manage Need for Speed Heat save profiles on Windows.

## Stack

- Go
- Wails v2
- React + TypeScript + Vite

## Goal

Switch between save profiles safely from a desktop UI, with backup and rollback support.

## Planned MVP

- Discover `SaveGame` path automatically (with manual override)
- Manage profiles in `Profiles/<name>`
- Track active profile using `active_profile.txt`
- Switch profile with prechecks, backup, and rollback on failure
- Create, rename, and delete profiles (active profile deletion blocked)

## Settings

- Custom `SaveGame` path is persisted between launches
- Settings file location: `%AppData%/HeatSaveManager/config.json`
- Manual path must point directly to the `SaveGame` directory

## Development

- Fast local verification (generate bindings + frontend build + backend tests): `scripts\verify.cmd`
- PowerShell variant: `./scripts/verify.ps1`
- Run app in development mode: `wails dev`
- Build distributable app: `wails build`
- Validate frontend changes: `npm run build --prefix frontend`
- Validate backend changes: `go test ./...`

### Repository Hygiene

- Line endings are normalized with `.gitattributes` and `.editorconfig` to reduce CRLF/LF-only diffs.
- `frontend/wailsjs/` is generated and ignored by git; regenerate it locally with `scripts\verify.cmd` or `wails dev`.
- Use `wails build -nosyncgomod -m` for binding refresh to avoid unintended `go.mod` churn.
- CI validates that `frontend/wailsjs/` stays untracked and that validation steps leave a clean git tree.
- See `CONTRIBUTING.md` for PR checklist and commit scope guidance.
