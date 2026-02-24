package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadReturnsDefaultWhenMissingFile(t *testing.T) {
	t.Parallel()

	store := NewStoreWithDir(filepath.Join(t.TempDir(), "config-root"))
	cfg, err := store.Load()
	if err != nil {
		t.Fatalf("load missing config: %v", err)
	}

	defaults := Default()
	if cfg.BackupBeforeSwitch != defaults.BackupBeforeSwitch {
		t.Fatalf("expected BackupBeforeSwitch=%v, got %v", defaults.BackupBeforeSwitch, cfg.BackupBeforeSwitch)
	}

	if cfg.CheckGameRunning != defaults.CheckGameRunning {
		t.Fatalf("expected CheckGameRunning=%v, got %v", defaults.CheckGameRunning, cfg.CheckGameRunning)
	}
}

func TestSaveAndLoadRoundTrip(t *testing.T) {
	t.Parallel()

	store := NewStoreWithDir(filepath.Join(t.TempDir(), "config-root"))
	wanted := AppConfig{
		SaveGamePath:       `C:\Users\Example\Documents\Need for speed heat\SaveGame`,
		ProfilesPath:       `C:\Users\Example\Documents\Need for speed heat\SaveGame\Profiles`,
		BackupBeforeSwitch: true,
		CheckGameRunning:   false,
	}

	if err := store.Save(wanted); err != nil {
		t.Fatalf("save config: %v", err)
	}

	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if loaded != wanted {
		t.Fatalf("expected %+v, got %+v", wanted, loaded)
	}
}

func TestLoadInvalidJSONFails(t *testing.T) {
	t.Parallel()

	store := NewStoreWithDir(filepath.Join(t.TempDir(), "config-root"))
	if err := os.MkdirAll(filepath.Dir(store.Path()), 0o755); err != nil {
		t.Fatalf("mkdir config dir: %v", err)
	}

	if err := os.WriteFile(store.Path(), []byte("{not-json}"), 0o644); err != nil {
		t.Fatalf("write invalid json: %v", err)
	}

	if _, err := store.Load(); err == nil {
		t.Fatal("expected invalid json error")
	}
}
