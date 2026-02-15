package profiles

import (
	"os"
	"path/filepath"
	"testing"
)

func TestListCreatesProfilesDirectoryWhenMissing(t *testing.T) {
	t.Parallel()

	profilesPath := filepath.Join(t.TempDir(), "Profiles")
	svc := NewService(profilesPath)

	items, err := svc.List()
	if err != nil {
		t.Fatalf("list profiles: %v", err)
	}

	if len(items) != 0 {
		t.Fatalf("expected no profiles, got %d", len(items))
	}

	info, err := os.Stat(profilesPath)
	if err != nil {
		t.Fatalf("stat profiles path: %v", err)
	}

	if !info.IsDir() {
		t.Fatalf("expected %q to be directory", profilesPath)
	}
}

func TestListReturnsOnlyValidProfilesSorted(t *testing.T) {
	t.Parallel()

	profilesPath := t.TempDir()

	createProfileLayout(t, profilesPath, "USA", true)
	createProfileLayout(t, profilesPath, "JPN", true)
	createProfileLayout(t, profilesPath, "EU", false)

	svc := NewService(profilesPath)
	items, err := svc.List()
	if err != nil {
		t.Fatalf("list profiles: %v", err)
	}

	if len(items) != 2 {
		t.Fatalf("expected 2 valid profiles, got %d", len(items))
	}

	if items[0].Name != "JPN" || items[1].Name != "USA" {
		t.Fatalf("expected sorted profiles [JPN USA], got [%s %s]", items[0].Name, items[1].Name)
	}
}

func TestValidateLayout(t *testing.T) {
	t.Parallel()

	base := t.TempDir()
	validPath := filepath.Join(base, "valid")
	invalidPath := filepath.Join(base, "invalid")

	createDir(t, filepath.Join(validPath, "savegame"))
	createDir(t, filepath.Join(validPath, "wraps"))
	createDir(t, filepath.Join(invalidPath, "savegame"))

	if err := ValidateLayout(validPath); err != nil {
		t.Fatalf("expected valid layout, got %v", err)
	}

	err := ValidateLayout(invalidPath)
	if err != ErrInvalidProfileLayout {
		t.Fatalf("expected ErrInvalidProfileLayout, got %v", err)
	}
}

func createProfileLayout(t *testing.T, profilesPath, name string, valid bool) {
	t.Helper()

	profilePath := filepath.Join(profilesPath, name)
	createDir(t, filepath.Join(profilePath, "savegame"))
	if valid {
		createDir(t, filepath.Join(profilePath, "wraps"))
	}
}

func createDir(t *testing.T, path string) {
	t.Helper()

	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
}
