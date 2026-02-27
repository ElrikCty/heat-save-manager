package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
