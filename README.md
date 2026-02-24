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

- Run app in development mode: `wails dev`
- Build distributable app: `wails build`
- Validate frontend changes: `npm run build --prefix frontend`
- Validate backend changes: `go test ./...`

### Repository Hygiene

- Line endings are normalized with `.gitattributes` and `.editorconfig` to reduce CRLF/LF-only diffs.
- `wails build` may regenerate files under `frontend/wailsjs/`; commit those changes only when the generated API surface actually changed.
