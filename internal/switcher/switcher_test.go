package switcher

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"heat-save-manager/internal/fsops"
	"heat-save-manager/internal/marker"
)

func TestSwitchReplacesRootAndUpdatesMarker(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	profileName := "USA"

	createProfile(t, profilesPath, profileName, "new-save", "new-wrap")
	createDirWithFile(t, filepath.Join(saveGamePath, "savegame"), "slot.sav", "old-save")
	createDirWithFile(t, filepath.Join(saveGamePath, "wraps"), "wrap.txt", "old-wrap")

	markerStore := marker.NewStore(saveGamePath)
	service := NewService(saveGamePath, profilesPath, markerStore, fsops.NewLocal())
	service.now = func() time.Time { return time.Date(2026, 2, 15, 12, 0, 0, 0, time.UTC) }

	result, err := service.Switch(Params{ProfileName: profileName})
	if err != nil {
		t.Fatalf("switch profile: %v", err)
	}

	if result.ProfileName != profileName {
		t.Fatalf("expected profile %q, got %q", profileName, result.ProfileName)
	}

	if result.RolledBack {
		t.Fatal("expected RolledBack=false")
	}

	assertFileContent(t, filepath.Join(saveGamePath, "savegame", "slot.sav"), "new-save")
	assertFileContent(t, filepath.Join(saveGamePath, "wraps", "wrap.txt"), "new-wrap")

	active, err := markerStore.ReadActiveProfile()
	if err != nil {
		t.Fatalf("read active marker: %v", err)
	}

	if active != profileName {
		t.Fatalf("expected active profile %q, got %q", profileName, active)
	}
}

func TestSwitchRollsBackWhenMarkerWriteFails(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	profileName := "JPN"

	createProfile(t, profilesPath, profileName, "new-save", "new-wrap")
	createDirWithFile(t, filepath.Join(saveGamePath, "savegame"), "slot.sav", "old-save")
	createDirWithFile(t, filepath.Join(saveGamePath, "wraps"), "wrap.txt", "old-wrap")

	service := NewService(saveGamePath, profilesPath, failingMarker{}, fsops.NewLocal())
	service.now = func() time.Time { return time.Date(2026, 2, 15, 12, 1, 0, 0, time.UTC) }

	result, err := service.Switch(Params{ProfileName: profileName})
	if err == nil {
		t.Fatal("expected switch to fail when marker update fails")
	}

	if !result.RolledBack {
		t.Fatal("expected RolledBack=true on failure")
	}

	assertFileContent(t, filepath.Join(saveGamePath, "savegame", "slot.sav"), "old-save")
	assertFileContent(t, filepath.Join(saveGamePath, "wraps", "wrap.txt"), "old-wrap")
}

func TestSwitchRollsBackWhenSecondReplaceFails(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	profileName := "EU"

	createProfile(t, profilesPath, profileName, "new-save", "new-wrap")
	createDirWithFile(t, filepath.Join(saveGamePath, "savegame"), "slot.sav", "old-save")
	createDirWithFile(t, filepath.Join(saveGamePath, "wraps"), "wrap.txt", "old-wrap")

	failingOps := &failOnSecondReplaceOps{base: fsops.NewLocal()}
	service := NewService(saveGamePath, profilesPath, marker.NewStore(saveGamePath), failingOps)
	service.now = func() time.Time { return time.Date(2026, 2, 15, 12, 2, 0, 0, time.UTC) }

	result, err := service.Switch(Params{ProfileName: profileName})
	if err == nil {
		t.Fatal("expected switch to fail")
	}

	if !result.RolledBack {
		t.Fatal("expected RolledBack=true")
	}

	assertFileContent(t, filepath.Join(saveGamePath, "savegame", "slot.sav"), "old-save")
	assertFileContent(t, filepath.Join(saveGamePath, "wraps", "wrap.txt"), "old-wrap")
}

func TestSwitchRequiresValidInputs(t *testing.T) {
	t.Parallel()

	service := NewService("", "", nil, nil)

	_, err := service.Switch(Params{ProfileName: " "})
	if !errors.Is(err, ErrProfileNameRequired) {
		t.Fatalf("expected ErrProfileNameRequired, got %v", err)
	}
}

type failingMarker struct{}

func (f failingMarker) WriteActiveProfile(profileName string) error {
	_ = profileName
	return errors.New("marker failure")
}

type failOnSecondReplaceOps struct {
	base         *fsops.Local
	replaceCalls int
}

func (f *failOnSecondReplaceOps) CopyDir(source string, destination string) error {
	return f.base.CopyDir(source, destination)
}

func (f *failOnSecondReplaceOps) ReplaceDir(source string, destination string) error {
	f.replaceCalls++
	if f.replaceCalls == 2 {
		return errors.New("forced replace failure")
	}

	return f.base.ReplaceDir(source, destination)
}

func (f *failOnSecondReplaceOps) RemoveDir(path string) error {
	return f.base.RemoveDir(path)
}

func createProfile(t *testing.T, profilesPath string, profileName string, saveContent string, wrapContent string) {
	t.Helper()

	profileRoot := filepath.Join(profilesPath, profileName)
	createDirWithFile(t, filepath.Join(profileRoot, "savegame"), "slot.sav", saveContent)
	createDirWithFile(t, filepath.Join(profileRoot, "wraps"), "wrap.txt", wrapContent)
}

func createDirWithFile(t *testing.T, dir string, fileName string, content string) {
	t.Helper()

	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", dir, err)
	}

	path := filepath.Join(dir, fileName)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write file %s: %v", path, err)
	}
}

func assertFileContent(t *testing.T, path string, expected string) {
	t.Helper()

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read file %s: %v", path, err)
	}

	if string(data) != expected {
		t.Fatalf("expected %q, got %q", expected, string(data))
	}
}
