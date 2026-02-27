package bundle

import (
	"archive/zip"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"heat-save-manager/internal/profiles"
)

func TestExportAndImportProfileRoundTrip(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	profilesPath := filepath.Join(root, "Profiles")
	profileName := "ProfileAlpha"
	profileRoot := filepath.Join(profilesPath, profileName)

	writeFile(t, filepath.Join(profileRoot, "savegame", "slot.sav"), "save-data")
	writeFile(t, filepath.Join(profileRoot, "wraps", "wrap.txt"), "wrap-data")

	svc := NewService(profilesPath)
	bundlePath := filepath.Join(root, "bundles", "profile-alpha.zip")

	if err := svc.ExportProfile(profileName, bundlePath); err != nil {
		t.Fatalf("export profile: %v", err)
	}

	if err := os.RemoveAll(profileRoot); err != nil {
		t.Fatalf("remove original profile: %v", err)
	}

	if err := svc.ImportProfile(profileName, bundlePath); err != nil {
		t.Fatalf("import profile: %v", err)
	}

	assertFileContent(t, filepath.Join(profileRoot, "savegame", "slot.sav"), "save-data")
	assertFileContent(t, filepath.Join(profileRoot, "wraps", "wrap.txt"), "wrap-data")
}

func TestExportProfileRequiresValidLayout(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	profilesPath := filepath.Join(root, "Profiles")
	profileRoot := filepath.Join(profilesPath, "BrokenProfile")

	writeFile(t, filepath.Join(profileRoot, "savegame", "slot.sav"), "save-data")

	svc := NewService(profilesPath)
	err := svc.ExportProfile("BrokenProfile", filepath.Join(root, "broken.zip"))
	if !errors.Is(err, profiles.ErrInvalidProfileLayout) {
		t.Fatalf("expected ErrInvalidProfileLayout, got %v", err)
	}
}

func TestImportProfileBlocksZipSlipPaths(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	profilesPath := filepath.Join(root, "Profiles")
	profileRoot := filepath.Join(profilesPath, "ProfileUnsafe")
	bundlePath := filepath.Join(root, "unsafe.zip")

	writeFile(t, filepath.Join(profileRoot, "savegame", "slot.sav"), "original-save")
	writeFile(t, filepath.Join(profileRoot, "wraps", "wrap.txt"), "original-wrap")

	createZipWithEntry(t, bundlePath, "../escape.txt", "bad")

	svc := NewService(profilesPath)
	err := svc.ImportProfile("ProfileUnsafe", bundlePath)
	if err == nil {
		t.Fatal("expected zip slip validation error")
	}

	assertFileContent(t, filepath.Join(profileRoot, "savegame", "slot.sav"), "original-save")
	assertFileContent(t, filepath.Join(profileRoot, "wraps", "wrap.txt"), "original-wrap")
}

func TestImportProfileKeepsExistingDataWhenBundleLayoutIsInvalid(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	profilesPath := filepath.Join(root, "Profiles")
	profileRoot := filepath.Join(profilesPath, "ProfileBroken")
	bundlePath := filepath.Join(root, "broken-layout.zip")

	writeFile(t, filepath.Join(profileRoot, "savegame", "slot.sav"), "original-save")
	writeFile(t, filepath.Join(profileRoot, "wraps", "wrap.txt"), "original-wrap")

	createZipWithEntry(t, bundlePath, "savegame/slot.sav", "new-save-only")

	svc := NewService(profilesPath)
	err := svc.ImportProfile("ProfileBroken", bundlePath)
	if !errors.Is(err, profiles.ErrInvalidProfileLayout) {
		t.Fatalf("expected ErrInvalidProfileLayout, got %v", err)
	}

	assertFileContent(t, filepath.Join(profileRoot, "savegame", "slot.sav"), "original-save")
	assertFileContent(t, filepath.Join(profileRoot, "wraps", "wrap.txt"), "original-wrap")
}

func createZipWithEntry(t *testing.T, zipPath string, entryName string, content string) {
	t.Helper()

	if err := os.MkdirAll(filepath.Dir(zipPath), 0o755); err != nil {
		t.Fatalf("mkdir zip dir: %v", err)
	}

	zf, err := os.Create(zipPath)
	if err != nil {
		t.Fatalf("create zip: %v", err)
	}

	archive := zip.NewWriter(zf)
	w, err := archive.Create(entryName)
	if err != nil {
		t.Fatalf("create zip entry: %v", err)
	}

	if _, err := w.Write([]byte(content)); err != nil {
		t.Fatalf("write zip entry: %v", err)
	}

	if err := archive.Close(); err != nil {
		t.Fatalf("close zip writer: %v", err)
	}

	if err := zf.Close(); err != nil {
		t.Fatalf("close zip file: %v", err)
	}
}

func writeFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir for %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func assertFileContent(t *testing.T, path string, expected string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if string(data) != expected {
		t.Fatalf("expected %q, got %q", expected, string(data))
	}
}
