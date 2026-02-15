package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"heat-save-manager/internal/discovery"
	"heat-save-manager/internal/fsops"
	"heat-save-manager/internal/marker"
	"heat-save-manager/internal/profiles"
	"heat-save-manager/internal/switcher"
)

// App struct
type App struct {
	ctx          context.Context
	saveGamePath string
	profilesPath string
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.initDefaultPaths()
}

type ProfileItem struct {
	Name string `json:"name"`
}

type AppPaths struct {
	SaveGamePath string `json:"saveGamePath"`
	ProfilesPath string `json:"profilesPath"`
}

func (a *App) initDefaultPaths() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}

	documentsPath := filepath.Join(home, "Documents")
	paths, err := discovery.NewService(documentsPath).Locate()
	if err != nil {
		return
	}

	a.saveGamePath = paths.SaveGamePath
	a.profilesPath = paths.ProfilesPath
}

func (a *App) SetSaveGamePath(saveGamePath string) error {
	trimmed := strings.TrimSpace(saveGamePath)
	if trimmed == "" {
		return errors.New("savegame path is required")
	}

	a.saveGamePath = trimmed
	a.profilesPath = filepath.Join(trimmed, "Profiles")

	return nil
}

func (a *App) GetPaths() AppPaths {
	return AppPaths{
		SaveGamePath: a.saveGamePath,
		ProfilesPath: a.profilesPath,
	}
}

func (a *App) ListProfiles() ([]ProfileItem, error) {
	service := profiles.NewService(a.profilesPath)
	items, err := service.List()
	if err != nil {
		return nil, err
	}

	result := make([]ProfileItem, 0, len(items))
	for _, item := range items {
		result = append(result, ProfileItem{Name: item.Name})
	}

	return result, nil
}

func (a *App) GetActiveProfile() (string, error) {
	store := marker.NewStore(a.saveGamePath)
	return store.ReadActiveProfile()
}

func (a *App) SwitchProfile(profileName string) (switcher.Result, error) {
	store := marker.NewStore(a.saveGamePath)
	service := switcher.NewService(a.saveGamePath, a.profilesPath, store, fsops.NewLocal())

	return service.Switch(switcher.Params{ProfileName: profileName})
}
