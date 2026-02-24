package health

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"heat-save-manager/internal/config"
)

func TestRunReturnsErrorWhenSaveGamePathMissing(t *testing.T) {
	t.Parallel()

	svc := NewService("", "")
	report := svc.Run()

	if report.Ready {
		t.Fatal("expected report not ready when savegame path is missing")
	}

	if len(report.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(report.Items))
	}

	if report.Items[0].Severity != "error" {
		t.Fatalf("expected error severity, got %q", report.Items[0].Severity)
	}
}

func TestRunHealthyConfiguration(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	activeProfile := filepath.Join(profilesPath, "ProfileAlpha")

	createDir(t, filepath.Join(saveGamePath, "savegame"))
	createDir(t, filepath.Join(saveGamePath, "wraps"))
	createDir(t, activeProfile)
	writeFile(t, filepath.Join(saveGamePath, config.MarkerFileName), "ProfileAlpha\n")

	svc := NewService(saveGamePath, profilesPath)
	svc.now = func() time.Time {
		return time.Date(2026, 2, 24, 18, 0, 0, 0, time.UTC)
	}

	report := svc.Run()
	if !report.Ready {
		t.Fatal("expected report ready for healthy configuration")
	}

	if len(report.Items) < 6 {
		t.Fatalf("expected at least 6 checks, got %d", len(report.Items))
	}
}

func TestRunWarnsWhenMarkerDoesNotMatchProfile(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")

	createDir(t, filepath.Join(saveGamePath, "savegame"))
	createDir(t, filepath.Join(saveGamePath, "wraps"))
	createDir(t, profilesPath)
	writeFile(t, filepath.Join(saveGamePath, config.MarkerFileName), "GhostProfile\n")

	svc := NewService(saveGamePath, profilesPath)
	report := svc.Run()

	if !report.Ready {
		t.Fatal("expected report ready with warnings only")
	}

	foundWarn := false
	for _, item := range report.Items {
		if item.Name == "active_profile_folder" && item.Severity == "warn" {
			foundWarn = true
			break
		}
	}

	if !foundWarn {
		t.Fatal("expected warning for active profile folder mismatch")
	}
}

func TestRunNotReadyWhenMarkerMissing(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")

	createDir(t, filepath.Join(saveGamePath, "savegame"))
	createDir(t, filepath.Join(saveGamePath, "wraps"))
	createDir(t, profilesPath)

	svc := NewService(saveGamePath, profilesPath)
	report := svc.Run()

	if report.Ready {
		t.Fatal("expected report not ready when marker file is missing")
	}

	foundError := false
	for _, item := range report.Items {
		if item.Name == "marker_file" && item.Severity == "error" {
			foundError = true
			break
		}
	}

	if !foundError {
		t.Fatal("expected marker_file error when marker file is missing")
	}
}

func createDir(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
}

func writeFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir for file %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
