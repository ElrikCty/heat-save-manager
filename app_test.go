package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"heat-save-manager/internal/config"
)

func TestApplySaveGamePathRequiresNeedForSpeedHeatParent(t *testing.T) {
	app := &App{}
	root := t.TempDir()

	invalidSaveGamePath := filepath.Join(root, "SomeOtherGame", "SaveGame")
	if err := os.MkdirAll(invalidSaveGamePath, 0o755); err != nil {
		t.Fatalf("create invalid savegame path: %v", err)
	}

	err := app.applySaveGamePath(invalidSaveGamePath)
	if err == nil {
		t.Fatalf("expected validation error for parent directory")
	}

	if !strings.Contains(strings.ToLower(err.Error()), "need for speed heat") {
		t.Fatalf("unexpected validation error: %v", err)
	}
}

func TestApplySaveGamePathAcceptsNeedForSpeedHeatParent(t *testing.T) {
	app := &App{}
	root := t.TempDir()

	validSaveGamePath := filepath.Join(root, "Need for speed heat", "SaveGame")
	if err := os.MkdirAll(validSaveGamePath, 0o755); err != nil {
		t.Fatalf("create valid savegame path: %v", err)
	}

	if err := app.applySaveGamePath(validSaveGamePath); err != nil {
		t.Fatalf("expected path to pass validation: %v", err)
	}

	if app.saveGamePath != validSaveGamePath {
		t.Fatalf("unexpected savegame path: got %q want %q", app.saveGamePath, validSaveGamePath)
	}

	expectedProfilesPath := filepath.Join(validSaveGamePath, "Profiles")
	if app.profilesPath != expectedProfilesPath {
		t.Fatalf("unexpected profiles path: got %q want %q", app.profilesPath, expectedProfilesPath)
	}

	if info, err := os.Stat(expectedProfilesPath); err != nil || !info.IsDir() {
		t.Fatalf("profiles path was not created correctly: %v", err)
	}
}

func TestCreateMarkerFileRejectsInvalidProfileName(t *testing.T) {
	app := &App{}
	root := t.TempDir()
	app.saveGamePath = filepath.Join(root, "SaveGame")
	app.profilesPath = filepath.Join(app.saveGamePath, "Profiles")

	if err := os.MkdirAll(app.profilesPath, 0o755); err != nil {
		t.Fatalf("create profiles path: %v", err)
	}

	err := app.CreateMarkerFile("..")
	if err == nil {
		t.Fatalf("expected invalid profile name error")
	}

	if !strings.Contains(strings.ToLower(err.Error()), "invalid") {
		t.Fatalf("unexpected error for invalid profile name: %v", err)
	}
}

func TestCreateMarkerFileAcceptsValidExistingProfile(t *testing.T) {
	app := &App{}
	root := t.TempDir()
	app.saveGamePath = filepath.Join(root, "SaveGame")
	app.profilesPath = filepath.Join(app.saveGamePath, "Profiles")
	profileName := "ProfileAlpha"

	if err := os.MkdirAll(filepath.Join(app.profilesPath, profileName), 0o755); err != nil {
		t.Fatalf("create profile directory: %v", err)
	}

	if err := app.CreateMarkerFile(profileName); err != nil {
		t.Fatalf("expected marker creation to succeed: %v", err)
	}
}

func TestGetLanguageDefaultsToEnglish(t *testing.T) {
	app := &App{}

	if got := app.GetLanguage(); got != languageEnglish {
		t.Fatalf("expected default language %q, got %q", languageEnglish, got)
	}
}

func TestSetLanguagePersistsSelection(t *testing.T) {
	store := config.NewStoreWithDir(filepath.Join(t.TempDir(), "config-root"))
	app := &App{configStore: store}

	if err := app.SetLanguage("es"); err != nil {
		t.Fatalf("set language: %v", err)
	}

	if got := app.GetLanguage(); got != languageSpanish {
		t.Fatalf("expected app language %q, got %q", languageSpanish, got)
	}

	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if loaded.Language != languageSpanish {
		t.Fatalf("expected persisted language %q, got %q", languageSpanish, loaded.Language)
	}
}

func TestSetLanguageRejectsUnsupportedLanguage(t *testing.T) {
	app := &App{}

	if err := app.SetLanguage("fr"); err == nil {
		t.Fatal("expected unsupported language error")
	}
}

func TestSetSaveGamePathPreservesConfiguredLanguage(t *testing.T) {
	store := config.NewStoreWithDir(filepath.Join(t.TempDir(), "config-root"))
	if err := store.Save(config.AppConfig{Language: languageSpanish}); err != nil {
		t.Fatalf("save seed config: %v", err)
	}

	root := t.TempDir()
	validSaveGamePath := filepath.Join(root, "Need for speed heat", "SaveGame")
	if err := os.MkdirAll(validSaveGamePath, 0o755); err != nil {
		t.Fatalf("create valid savegame path: %v", err)
	}

	app := &App{configStore: store}
	if err := app.SetSaveGamePath(validSaveGamePath); err != nil {
		t.Fatalf("set savegame path: %v", err)
	}

	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("load updated config: %v", err)
	}

	if loaded.Language != languageSpanish {
		t.Fatalf("expected language %q to be preserved, got %q", languageSpanish, loaded.Language)
	}
}

func TestApplySavedSettingsLoadsLanguageWithoutPath(t *testing.T) {
	store := config.NewStoreWithDir(filepath.Join(t.TempDir(), "config-root"))
	if err := store.Save(config.AppConfig{Language: languageSpanish}); err != nil {
		t.Fatalf("save config: %v", err)
	}

	app := &App{configStore: store}
	app.applySavedSettings()

	if got := app.GetLanguage(); got != languageSpanish {
		t.Fatalf("expected loaded language %q, got %q", languageSpanish, got)
	}
}

func TestSelectPreferredWindowsAssetPrefersInstallerVariants(t *testing.T) {
	assets := []releaseAsset{
		{Name: "HeatSaveManager-v1.0.9-windows-x64.zip", BrowserDownloadURL: "https://example.com/app.zip"},
		{Name: "HeatSaveManager-v1.0.9-windows-x64.exe", BrowserDownloadURL: "https://example.com/app.exe"},
		{Name: "HeatSaveManager-amd64-installer.exe", BrowserDownloadURL: "https://example.com/app-installer.exe"},
	}

	selected := selectPreferredWindowsAsset(assets)
	if selected.Kind != "installer" {
		t.Fatalf("expected installer asset, got %q", selected.Kind)
	}

	if selected.URL != "https://example.com/app-installer.exe" {
		t.Fatalf("unexpected installer url: %q", selected.URL)
	}

	if selected.InAppReason != "" {
		t.Fatalf("expected empty in-app reason for installer selection, got %q", selected.InAppReason)
	}
}

func TestSelectPreferredWindowsAssetFallsBackWhenInstallerMissing(t *testing.T) {
	assets := []releaseAsset{
		{Name: "HeatSaveManager-v1.0.9-windows-x64.zip", BrowserDownloadURL: "https://example.com/app.zip"},
		{Name: "HeatSaveManager-v1.0.9-windows-x64.exe", BrowserDownloadURL: "https://example.com/app.exe"},
	}

	selected := selectPreferredWindowsAsset(assets)
	if selected.Kind != "exe" {
		t.Fatalf("expected exe fallback, got %q", selected.Kind)
	}

	if selected.URL != "https://example.com/app.exe" {
		t.Fatalf("unexpected exe fallback url: %q", selected.URL)
	}

	if !strings.Contains(strings.ToLower(selected.InAppReason), "installer") {
		t.Fatalf("expected installer-missing reason, got %q", selected.InAppReason)
	}
}

func TestSelectPreferredWindowsAssetSkipsArmInstaller(t *testing.T) {
	assets := []releaseAsset{
		{Name: "HeatSaveManager-v1.0.9-windows-arm64-installer.exe", BrowserDownloadURL: "https://example.com/app-arm-installer.exe"},
		{Name: "HeatSaveManager-v1.0.9-windows-x64.exe", BrowserDownloadURL: "https://example.com/app.exe"},
	}

	selected := selectPreferredWindowsAsset(assets)
	if selected.Kind != "exe" {
		t.Fatalf("expected x64 exe fallback, got %q", selected.Kind)
	}

	if selected.URL != "https://example.com/app.exe" {
		t.Fatalf("unexpected fallback url: %q", selected.URL)
	}

	if !strings.Contains(strings.ToLower(selected.InAppReason), "installer") {
		t.Fatalf("expected installer-missing reason, got %q", selected.InAppReason)
	}
}
