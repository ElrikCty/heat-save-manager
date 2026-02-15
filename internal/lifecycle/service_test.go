package lifecycle

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"heat-save-manager/internal/fsops"
	"heat-save-manager/internal/marker"
)

func TestPrepareFreshProfileRemovesRootDirsAndUpdatesMarker(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")

	createDirWithFile(t, filepath.Join(saveGamePath, "savegame"), "slot.sav", "old-save")
	createDirWithFile(t, filepath.Join(saveGamePath, "wraps"), "wrap.txt", "old-wrap")

	store := marker.NewStore(saveGamePath)
	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())

	if err := svc.PrepareFreshProfile("fresh-01"); err != nil {
		t.Fatalf("prepare fresh profile: %v", err)
	}

	_, saveErr := os.Stat(filepath.Join(saveGamePath, "savegame"))
	if !os.IsNotExist(saveErr) {
		t.Fatalf("expected root savegame removed, got %v", saveErr)
	}

	_, wrapsErr := os.Stat(filepath.Join(saveGamePath, "wraps"))
	if !os.IsNotExist(wrapsErr) {
		t.Fatalf("expected root wraps removed, got %v", wrapsErr)
	}

	active, err := store.ReadActiveProfile()
	if err != nil {
		t.Fatalf("read marker: %v", err)
	}

	if active != "fresh-01" {
		t.Fatalf("expected active profile fresh-01, got %q", active)
	}
}

func TestSaveCurrentProfileWritesIntoNamedProfile(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")

	createDirWithFile(t, filepath.Join(saveGamePath, "savegame"), "slot.sav", "new-save")
	createDirWithFile(t, filepath.Join(saveGamePath, "wraps"), "wrap.txt", "new-wrap")

	svc := NewService(saveGamePath, profilesPath, marker.NewStore(saveGamePath), fsops.NewLocal())
	if err := svc.SaveCurrentProfile("USA"); err != nil {
		t.Fatalf("save current profile: %v", err)
	}

	assertFileContent(t, filepath.Join(profilesPath, "USA", "savegame", "slot.sav"), "new-save")
	assertFileContent(t, filepath.Join(profilesPath, "USA", "wraps", "wrap.txt"), "new-wrap")
}

func TestSaveCurrentProfileUsesActiveMarkerNameWhenEmpty(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")

	createDirWithFile(t, filepath.Join(saveGamePath, "savegame"), "slot.sav", "save")
	createDirWithFile(t, filepath.Join(saveGamePath, "wraps"), "wrap.txt", "wrap")

	store := marker.NewStore(saveGamePath)
	if err := store.WriteActiveProfile("EU"); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())
	if err := svc.SaveCurrentProfile(""); err != nil {
		t.Fatalf("save with active marker: %v", err)
	}

	assertFileContent(t, filepath.Join(profilesPath, "EU", "savegame", "slot.sav"), "save")
	assertFileContent(t, filepath.Join(profilesPath, "EU", "wraps", "wrap.txt"), "wrap")
}

func TestSaveCurrentProfileRequiresRootFolders(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")

	svc := NewService(saveGamePath, profilesPath, marker.NewStore(saveGamePath), fsops.NewLocal())
	err := svc.SaveCurrentProfile("JPN")
	if !errors.Is(err, ErrRootSavegameMissing) {
		t.Fatalf("expected ErrRootSavegameMissing, got %v", err)
	}
}

func TestRenameProfileRenamesFolderAndActiveMarker(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	createDirWithFile(t, filepath.Join(profilesPath, "USA", "savegame"), "slot.sav", "save")
	createDirWithFile(t, filepath.Join(profilesPath, "USA", "wraps"), "wrap.txt", "wrap")

	store := marker.NewStore(saveGamePath)
	if err := store.WriteActiveProfile("USA"); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())
	if err := svc.RenameProfile("USA", "NA"); err != nil {
		t.Fatalf("rename profile: %v", err)
	}

	if _, err := os.Stat(filepath.Join(profilesPath, "USA")); !os.IsNotExist(err) {
		t.Fatalf("expected old profile folder removed, got %v", err)
	}

	if _, err := os.Stat(filepath.Join(profilesPath, "NA")); err != nil {
		t.Fatalf("expected new profile folder exists, got %v", err)
	}

	active, err := store.ReadActiveProfile()
	if err != nil {
		t.Fatalf("read active marker: %v", err)
	}

	if active != "NA" {
		t.Fatalf("expected active marker NA, got %q", active)
	}
}

func TestDeleteProfileBlocksActiveProfile(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	createDirWithFile(t, filepath.Join(profilesPath, "USA", "savegame"), "slot.sav", "save")
	createDirWithFile(t, filepath.Join(profilesPath, "USA", "wraps"), "wrap.txt", "wrap")

	store := marker.NewStore(saveGamePath)
	if err := store.WriteActiveProfile("USA"); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())
	err := svc.DeleteProfile("USA")
	if !errors.Is(err, ErrCannotDeleteActiveProfile) {
		t.Fatalf("expected ErrCannotDeleteActiveProfile, got %v", err)
	}
}

func TestDeleteProfileRemovesNonActiveProfile(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	createDirWithFile(t, filepath.Join(profilesPath, "EU", "savegame"), "slot.sav", "save")
	createDirWithFile(t, filepath.Join(profilesPath, "EU", "wraps"), "wrap.txt", "wrap")

	store := marker.NewStore(saveGamePath)
	if err := store.WriteActiveProfile("USA"); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())
	if err := svc.DeleteProfile("EU"); err != nil {
		t.Fatalf("delete profile: %v", err)
	}

	if _, err := os.Stat(filepath.Join(profilesPath, "EU")); !os.IsNotExist(err) {
		t.Fatalf("expected deleted profile not found, got %v", err)
	}
}

func TestRenameProfileRollsBackFolderWhenMarkerWriteFails(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	createDirWithFile(t, filepath.Join(profilesPath, "USA", "savegame"), "slot.sav", "save")
	createDirWithFile(t, filepath.Join(profilesPath, "USA", "wraps"), "wrap.txt", "wrap")

	svc := NewService(saveGamePath, profilesPath, failingRenameMarker{}, fsops.NewLocal())
	err := svc.RenameProfile("USA", "NA")
	if err == nil {
		t.Fatal("expected rename to fail when marker update fails")
	}

	if _, statErr := os.Stat(filepath.Join(profilesPath, "USA")); statErr != nil {
		t.Fatalf("expected original folder restored, got %v", statErr)
	}

	if _, statErr := os.Stat(filepath.Join(profilesPath, "NA")); !os.IsNotExist(statErr) {
		t.Fatalf("expected new folder rolled back, got %v", statErr)
	}
}

func TestPrepareFreshProfileRejectsInvalidName(t *testing.T) {
	t.Parallel()

	svc := NewService("save", "profiles", marker.NewStore(t.TempDir()), fsops.NewLocal())
	err := svc.PrepareFreshProfile("BAD/NAME")
	if !errors.Is(err, ErrProfileNameInvalid) {
		t.Fatalf("expected ErrProfileNameInvalid, got %v", err)
	}
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

type failingRenameMarker struct{}

func (f failingRenameMarker) ReadActiveProfile() (string, error) {
	return "USA", nil
}

func (f failingRenameMarker) WriteActiveProfile(profileName string) error {
	_ = profileName
	return errors.New("marker write failure")
}
