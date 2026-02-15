package marker

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteAndReadActiveProfile(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	store := NewStore(root)

	if err := store.WriteActiveProfile(" ProfileOne "); err != nil {
		t.Fatalf("write active profile: %v", err)
	}

	got, err := store.ReadActiveProfile()
	if err != nil {
		t.Fatalf("read active profile: %v", err)
	}

	if got != "ProfileOne" {
		t.Fatalf("expected profile ProfileOne, got %q", got)
	}
}

func TestWriteActiveProfileRejectsEmptyName(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	store := NewStore(root)

	err := store.WriteActiveProfile("   ")
	if err != ErrProfileNameRequired {
		t.Fatalf("expected ErrProfileNameRequired, got %v", err)
	}
}

func TestReadActiveProfileMissingFile(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	store := NewStore(root)

	_, err := store.ReadActiveProfile()
	if err == nil {
		t.Fatal("expected error when marker file is missing")
	}

	if !os.IsNotExist(err) {
		t.Fatalf("expected os.IsNotExist error, got %v", err)
	}

	if filepath.Base(store.Path()) != "active_profile.txt" {
		t.Fatalf("expected marker file name active_profile.txt, got %q", filepath.Base(store.Path()))
	}
}
