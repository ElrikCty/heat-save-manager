package fsops

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestCopyDirCopiesNestedFiles(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	source := filepath.Join(root, "source")
	destination := filepath.Join(root, "destination")

	createFile(t, filepath.Join(source, "savegame", "save1.sav"), "save-content")
	createFile(t, filepath.Join(source, "wraps", "car-wrap.txt"), "wrap-content")

	ops := NewLocal()
	if err := ops.CopyDir(source, destination); err != nil {
		t.Fatalf("copy dir: %v", err)
	}

	assertFileContent(t, filepath.Join(destination, "savegame", "save1.sav"), "save-content")
	assertFileContent(t, filepath.Join(destination, "wraps", "car-wrap.txt"), "wrap-content")
}

func TestCopyDirRequiresDirectorySource(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	sourceFile := filepath.Join(root, "source.txt")
	createFile(t, sourceFile, "not-a-dir")

	ops := NewLocal()
	err := ops.CopyDir(sourceFile, filepath.Join(root, "destination"))
	if !errors.Is(err, ErrSourceMustBeDirectory) {
		t.Fatalf("expected ErrSourceMustBeDirectory, got %v", err)
	}
}

func TestCopyDirReturnsNotExistForMissingSource(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	missingSource := filepath.Join(root, "does-not-exist")

	ops := NewLocal()
	err := ops.CopyDir(missingSource, filepath.Join(root, "destination"))
	if !os.IsNotExist(err) {
		t.Fatalf("expected os.IsNotExist error, got %v", err)
	}
}

func TestReplaceDirReplacesDestinationContents(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	source := filepath.Join(root, "source")
	destination := filepath.Join(root, "destination")

	createFile(t, filepath.Join(source, "savegame", "new.sav"), "new")
	createFile(t, filepath.Join(source, "wraps", "new.wrap"), "new-wrap")
	createFile(t, filepath.Join(destination, "savegame", "old.sav"), "old")

	ops := NewLocal()
	if err := ops.ReplaceDir(source, destination); err != nil {
		t.Fatalf("replace dir: %v", err)
	}

	assertFileContent(t, filepath.Join(destination, "savegame", "new.sav"), "new")
	assertFileContent(t, filepath.Join(destination, "wraps", "new.wrap"), "new-wrap")

	_, err := os.Stat(filepath.Join(destination, "savegame", "old.sav"))
	if !os.IsNotExist(err) {
		t.Fatalf("expected old file to be removed, got err=%v", err)
	}
}

func TestReplaceDirCreatesDestinationPathWhenMissing(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	source := filepath.Join(root, "source")
	destination := filepath.Join(root, "missing", "destination")

	createFile(t, filepath.Join(source, "savegame", "new.sav"), "new")

	ops := NewLocal()
	if err := ops.ReplaceDir(source, destination); err != nil {
		t.Fatalf("replace dir: %v", err)
	}

	assertFileContent(t, filepath.Join(destination, "savegame", "new.sav"), "new")
}

func TestRemoveDirRemovesDirectoryTree(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	target := filepath.Join(root, "to-remove")
	createFile(t, filepath.Join(target, "nested", "item.txt"), "value")

	ops := NewLocal()
	if err := ops.RemoveDir(target); err != nil {
		t.Fatalf("remove dir: %v", err)
	}

	_, err := os.Stat(target)
	if !os.IsNotExist(err) {
		t.Fatalf("expected target to be removed, got err=%v", err)
	}
}

func TestRemoveDirOnMissingPathDoesNotFail(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	target := filepath.Join(root, "missing")

	ops := NewLocal()
	if err := ops.RemoveDir(target); err != nil {
		t.Fatalf("remove missing dir: %v", err)
	}
}

func createFile(t *testing.T, path string, content string) {
	t.Helper()

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir for file %s: %v", path, err)
	}

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
