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

## Development

- Run app in development mode: `wails dev`
- Build distributable app: `wails build`
