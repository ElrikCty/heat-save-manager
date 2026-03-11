package lifecycle

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"heat-save-manager/internal/fsops"
	"heat-save-manager/internal/marker"
)

func TestPrepareFreshProfilePreserveUpdatesActiveAndCreatesFreshProfile(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")

	createDirWithFile(t, filepath.Join(saveGamePath, "savegame"), "slot.sav", "old-save")
	createDirWithFile(t, filepath.Join(saveGamePath, "wraps"), "wrap.txt", "old-wrap")

	store := marker.NewStore(saveGamePath)
	if err := store.WriteActiveProfile("current-main"); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())

	if err := svc.PrepareFreshProfile("fresh-01"); err != nil {
		t.Fatalf("prepare fresh profile: %v", err)
	}

	assertFileContent(t, filepath.Join(profilesPath, "current-main", "savegame", "slot.sav"), "old-save")
	assertFileContent(t, filepath.Join(profilesPath, "current-main", "wraps", "wrap.txt"), "old-wrap")
	assertDirEmpty(t, filepath.Join(profilesPath, "fresh-01", "savegame"))
	assertDirEmpty(t, filepath.Join(profilesPath, "fresh-01", "wraps"))
	assertDirEmpty(t, filepath.Join(saveGamePath, "savegame"))
	assertDirEmpty(t, filepath.Join(saveGamePath, "wraps"))

	active, err := store.ReadActiveProfile()
	if err != nil {
		t.Fatalf("read marker: %v", err)
	}

	if active != "fresh-01" {
		t.Fatalf("expected active profile fresh-01, got %q", active)
	}
}

func TestPrepareFreshProfilePreserveRequiresActiveMarker(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")

	createDirWithFile(t, filepath.Join(saveGamePath, "savegame"), "slot.sav", "old-save")
	createDirWithFile(t, filepath.Join(saveGamePath, "wraps"), "wrap.txt", "old-wrap")

	svc := NewService(saveGamePath, profilesPath, marker.NewStore(saveGamePath), fsops.NewLocal())
	err := svc.PrepareFreshProfile("fresh-01")
	if !errors.Is(err, ErrActiveProfileRequired) {
		t.Fatalf("expected ErrActiveProfileRequired, got %v", err)
	}
}

func TestPrepareFreshProfilePreserveRejectsSameAsActiveName(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")

	createDirWithFile(t, filepath.Join(saveGamePath, "savegame"), "slot.sav", "old-save")
	createDirWithFile(t, filepath.Join(saveGamePath, "wraps"), "wrap.txt", "old-wrap")

	store := marker.NewStore(saveGamePath)
	if err := store.WriteActiveProfile("fresh-01"); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())
	err := svc.PrepareFreshProfile("fresh-01")
	if !errors.Is(err, ErrFreshProfileNameConflict) {
		t.Fatalf("expected ErrFreshProfileNameConflict, got %v", err)
	}
}

func TestPrepareFreshProfilePreserveRejectsExistingProfileName(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")

	createDirWithFile(t, filepath.Join(saveGamePath, "savegame"), "slot.sav", "old-save")
	createDirWithFile(t, filepath.Join(saveGamePath, "wraps"), "wrap.txt", "old-wrap")
	createDirWithFile(t, filepath.Join(profilesPath, "fresh-01", "savegame"), "slot.sav", "existing-save")
	createDirWithFile(t, filepath.Join(profilesPath, "fresh-01", "wraps"), "wrap.txt", "existing-wrap")

	store := marker.NewStore(saveGamePath)
	if err := store.WriteActiveProfile("current-main"); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())
	err := svc.PrepareFreshProfile("fresh-01")
	if !errors.Is(err, ErrProfileAlreadyExists) {
		t.Fatalf("expected ErrProfileAlreadyExists, got %v", err)
	}

	assertFileContent(t, filepath.Join(saveGamePath, "savegame", "slot.sav"), "old-save")
	assertFileContent(t, filepath.Join(saveGamePath, "wraps", "wrap.txt"), "old-wrap")
	assertFileContent(t, filepath.Join(profilesPath, "fresh-01", "savegame", "slot.sav"), "existing-save")
	assertFileContent(t, filepath.Join(profilesPath, "fresh-01", "wraps", "wrap.txt"), "existing-wrap")

	active, err := store.ReadActiveProfile()
	if err != nil {
		t.Fatalf("read marker: %v", err)
	}

	if active != "current-main" {
		t.Fatalf("expected active profile current-main, got %q", active)
	}
}

func TestPrepareFreshProfileWithoutSaveRejectsExistingProfileName(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")

	createDirWithFile(t, filepath.Join(saveGamePath, "savegame"), "slot.sav", "old-save")
	createDirWithFile(t, filepath.Join(saveGamePath, "wraps"), "wrap.txt", "old-wrap")
	createDirWithFile(t, filepath.Join(profilesPath, "fresh-empty", "savegame"), "slot.sav", "existing-save")
	createDirWithFile(t, filepath.Join(profilesPath, "fresh-empty", "wraps"), "wrap.txt", "existing-wrap")

	svc := NewService(saveGamePath, profilesPath, marker.NewStore(saveGamePath), fsops.NewLocal())
	err := svc.PrepareFreshProfileWithoutSave("fresh-empty")
	if !errors.Is(err, ErrProfileAlreadyExists) {
		t.Fatalf("expected ErrProfileAlreadyExists, got %v", err)
	}

	assertFileContent(t, filepath.Join(saveGamePath, "savegame", "slot.sav"), "old-save")
	assertFileContent(t, filepath.Join(saveGamePath, "wraps", "wrap.txt"), "old-wrap")
	assertFileContent(t, filepath.Join(profilesPath, "fresh-empty", "savegame", "slot.sav"), "existing-save")
	assertFileContent(t, filepath.Join(profilesPath, "fresh-empty", "wraps", "wrap.txt"), "existing-wrap")
}

func assertDirEmpty(t *testing.T, path string) {
	t.Helper()

	entries, err := os.ReadDir(path)
	if err != nil {
		t.Fatalf("read dir %s: %v", path, err)
	}

	if len(entries) != 0 {
		t.Fatalf("expected dir %s to be empty, got %d entries", path, len(entries))
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
	if err := svc.SaveCurrentProfile("ProfileAlpha"); err != nil {
		t.Fatalf("save current profile: %v", err)
	}

	assertFileContent(t, filepath.Join(profilesPath, "ProfileAlpha", "savegame", "slot.sav"), "new-save")
	assertFileContent(t, filepath.Join(profilesPath, "ProfileAlpha", "wraps", "wrap.txt"), "new-wrap")
}

func TestSaveCurrentProfileKeepsExistingProfileWhenSecondReplaceFails(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")

	createDirWithFile(t, filepath.Join(saveGamePath, "savegame"), "slot.sav", "new-save")
	createDirWithFile(t, filepath.Join(saveGamePath, "wraps"), "wrap.txt", "new-wrap")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "savegame"), "slot.sav", "old-save")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "wraps"), "wrap.txt", "old-wrap")

	failingOps := &failOnSecondReplaceLifecycleOps{base: fsops.NewLocal()}
	svc := NewService(saveGamePath, profilesPath, marker.NewStore(saveGamePath), failingOps)
	err := svc.SaveCurrentProfile("ProfileAlpha")
	if err == nil {
		t.Fatal("expected save current to fail")
	}

	assertFileContent(t, filepath.Join(profilesPath, "ProfileAlpha", "savegame", "slot.sav"), "old-save")
	assertFileContent(t, filepath.Join(profilesPath, "ProfileAlpha", "wraps", "wrap.txt"), "old-wrap")
}

func TestSaveCurrentProfileUsesActiveMarkerNameWhenEmpty(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")

	createDirWithFile(t, filepath.Join(saveGamePath, "savegame"), "slot.sav", "save")
	createDirWithFile(t, filepath.Join(saveGamePath, "wraps"), "wrap.txt", "wrap")

	store := marker.NewStore(saveGamePath)
	if err := store.WriteActiveProfile("ProfileBeta"); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())
	if err := svc.SaveCurrentProfile(""); err != nil {
		t.Fatalf("save with active marker: %v", err)
	}

	assertFileContent(t, filepath.Join(profilesPath, "ProfileBeta", "savegame", "slot.sav"), "save")
	assertFileContent(t, filepath.Join(profilesPath, "ProfileBeta", "wraps", "wrap.txt"), "wrap")
}

func TestSaveCurrentProfileRequiresRootFolders(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")

	svc := NewService(saveGamePath, profilesPath, marker.NewStore(saveGamePath), fsops.NewLocal())
	err := svc.SaveCurrentProfile("ProfileGamma")
	if !errors.Is(err, ErrRootSavegameMissing) {
		t.Fatalf("expected ErrRootSavegameMissing, got %v", err)
	}
}

func TestRenameProfileRenamesFolderAndActiveMarker(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "savegame"), "slot.sav", "save")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "wraps"), "wrap.txt", "wrap")

	store := marker.NewStore(saveGamePath)
	if err := store.WriteActiveProfile("ProfileAlpha"); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())
	if err := svc.RenameProfile("ProfileAlpha", "ProfileDelta"); err != nil {
		t.Fatalf("rename profile: %v", err)
	}

	if _, err := os.Stat(filepath.Join(profilesPath, "ProfileAlpha")); !os.IsNotExist(err) {
		t.Fatalf("expected old profile folder removed, got %v", err)
	}

	if _, err := os.Stat(filepath.Join(profilesPath, "ProfileDelta")); err != nil {
		t.Fatalf("expected new profile folder exists, got %v", err)
	}

	active, err := store.ReadActiveProfile()
	if err != nil {
		t.Fatalf("read active marker: %v", err)
	}

	if active != "ProfileDelta" {
		t.Fatalf("expected active marker ProfileDelta, got %q", active)
	}
}

func TestRenameProfileUpdatesMarkerCaseInsensitively(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "savegame"), "slot.sav", "save")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "wraps"), "wrap.txt", "wrap")

	store := marker.NewStore(saveGamePath)
	if err := store.WriteActiveProfile("profilealpha"); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())
	if err := svc.RenameProfile("ProfileAlpha", "ProfileDelta"); err != nil {
		t.Fatalf("rename profile: %v", err)
	}

	active, err := store.ReadActiveProfile()
	if err != nil {
		t.Fatalf("read active marker: %v", err)
	}

	if active != "ProfileDelta" {
		t.Fatalf("expected active marker ProfileDelta, got %q", active)
	}
}

func TestDeleteProfileBlocksActiveProfile(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "savegame"), "slot.sav", "save")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "wraps"), "wrap.txt", "wrap")

	store := marker.NewStore(saveGamePath)
	if err := store.WriteActiveProfile("ProfileAlpha"); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())
	err := svc.DeleteProfile("ProfileAlpha")
	if !errors.Is(err, ErrCannotDeleteActiveProfile) {
		t.Fatalf("expected ErrCannotDeleteActiveProfile, got %v", err)
	}
}

func TestDeleteProfileBlocksActiveProfileCaseInsensitively(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "savegame"), "slot.sav", "save")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "wraps"), "wrap.txt", "wrap")

	store := marker.NewStore(saveGamePath)
	if err := store.WriteActiveProfile("profilealpha"); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())
	err := svc.DeleteProfile("ProfileAlpha")
	if !errors.Is(err, ErrCannotDeleteActiveProfile) {
		t.Fatalf("expected ErrCannotDeleteActiveProfile, got %v", err)
	}
}

func TestDeleteProfileRemovesNonActiveProfile(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileBeta", "savegame"), "slot.sav", "save")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileBeta", "wraps"), "wrap.txt", "wrap")

	store := marker.NewStore(saveGamePath)
	if err := store.WriteActiveProfile("ProfileAlpha"); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())
	if err := svc.DeleteProfile("ProfileBeta"); err != nil {
		t.Fatalf("delete profile: %v", err)
	}

	if _, err := os.Stat(filepath.Join(profilesPath, "ProfileBeta")); !os.IsNotExist(err) {
		t.Fatalf("expected deleted profile not found, got %v", err)
	}
}

func TestDeleteActiveProfileSwitchesReplacementAndRemovesOldProfile(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	createDirWithFile(t, filepath.Join(saveGamePath, "savegame"), "slot.sav", "root-save")
	createDirWithFile(t, filepath.Join(saveGamePath, "wraps"), "wrap.txt", "root-wrap")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "savegame"), "slot.sav", "alpha-save")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "wraps"), "wrap.txt", "alpha-wrap")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileBeta", "savegame"), "slot.sav", "beta-save")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileBeta", "wraps"), "wrap.txt", "beta-wrap")

	store := marker.NewStore(saveGamePath)
	if err := store.WriteActiveProfile("ProfileAlpha"); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())
	if err := svc.DeleteActiveProfile("ProfileBeta"); err != nil {
		t.Fatalf("delete active profile: %v", err)
	}

	if _, err := os.Stat(filepath.Join(profilesPath, "ProfileAlpha")); !os.IsNotExist(err) {
		t.Fatalf("expected deleted active profile not found, got %v", err)
	}

	assertFileContent(t, filepath.Join(saveGamePath, "savegame", "slot.sav"), "beta-save")
	assertFileContent(t, filepath.Join(saveGamePath, "wraps", "wrap.txt"), "beta-wrap")

	active, err := store.ReadActiveProfile()
	if err != nil {
		t.Fatalf("read active marker: %v", err)
	}

	if active != "ProfileBeta" {
		t.Fatalf("expected active marker ProfileBeta, got %q", active)
	}
}

func TestDeleteActiveProfileRejectsSameReplacement(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "savegame"), "slot.sav", "alpha-save")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "wraps"), "wrap.txt", "alpha-wrap")

	store := marker.NewStore(saveGamePath)
	if err := store.WriteActiveProfile("ProfileAlpha"); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())
	err := svc.DeleteActiveProfile("ProfileAlpha")
	if !errors.Is(err, ErrCannotDeleteActiveProfile) {
		t.Fatalf("expected ErrCannotDeleteActiveProfile, got %v", err)
	}
}

func TestDeleteActiveProfileRestoresFolderWhenCleanupFails(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "savegame"), "slot.sav", "alpha-save")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "wraps"), "wrap.txt", "alpha-wrap")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileBeta", "savegame"), "slot.sav", "beta-save")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileBeta", "wraps"), "wrap.txt", "beta-wrap")

	store := marker.NewStore(saveGamePath)
	if err := store.WriteActiveProfile("ProfileAlpha"); err != nil {
		t.Fatalf("write marker: %v", err)
	}

	svc := NewService(saveGamePath, profilesPath, store, &failDeleteActiveCleanupOps{base: fsops.NewLocal()})
	err := svc.DeleteActiveProfile("ProfileBeta")
	if err == nil {
		t.Fatal("expected delete active profile to fail during cleanup")
	}

	if _, err := os.Stat(filepath.Join(profilesPath, "ProfileAlpha")); err != nil {
		t.Fatalf("expected original active profile restored, got %v", err)
	}

	active, err := store.ReadActiveProfile()
	if err != nil {
		t.Fatalf("read active marker: %v", err)
	}

	if active != "ProfileBeta" {
		t.Fatalf("expected active marker ProfileBeta after successful switch, got %q", active)
	}
}

func TestRenameProfileRollsBackFolderWhenMarkerWriteFails(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "savegame"), "slot.sav", "save")
	createDirWithFile(t, filepath.Join(profilesPath, "ProfileAlpha", "wraps"), "wrap.txt", "wrap")

	svc := NewService(saveGamePath, profilesPath, failingRenameMarker{}, fsops.NewLocal())
	err := svc.RenameProfile("ProfileAlpha", "ProfileDelta")
	if err == nil {
		t.Fatal("expected rename to fail when marker update fails")
	}

	if _, statErr := os.Stat(filepath.Join(profilesPath, "ProfileAlpha")); statErr != nil {
		t.Fatalf("expected original folder restored, got %v", statErr)
	}

	if _, statErr := os.Stat(filepath.Join(profilesPath, "ProfileDelta")); !os.IsNotExist(statErr) {
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

func TestPrepareFreshProfileWithoutPreserveClearsRootAndCreatesEmptyProfile(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	saveGamePath := filepath.Join(root, "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")

	createDirWithFile(t, filepath.Join(saveGamePath, "savegame"), "slot.sav", "old-save")
	createDirWithFile(t, filepath.Join(saveGamePath, "wraps"), "wrap.txt", "old-wrap")

	store := marker.NewStore(saveGamePath)
	svc := NewService(saveGamePath, profilesPath, store, fsops.NewLocal())

	if err := svc.PrepareFreshProfileWithoutSave("fresh-empty"); err != nil {
		t.Fatalf("prepare fresh profile without preserve: %v", err)
	}

	assertDirEmpty(t, filepath.Join(saveGamePath, "savegame"))
	assertDirEmpty(t, filepath.Join(saveGamePath, "wraps"))
	assertDirEmpty(t, filepath.Join(profilesPath, "fresh-empty", "savegame"))
	assertDirEmpty(t, filepath.Join(profilesPath, "fresh-empty", "wraps"))

	active, err := store.ReadActiveProfile()
	if err != nil {
		t.Fatalf("read marker: %v", err)
	}

	if active != "fresh-empty" {
		t.Fatalf("expected active profile fresh-empty, got %q", active)
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
	return "ProfileAlpha", nil
}

func (f failingRenameMarker) WriteActiveProfile(profileName string) error {
	_ = profileName
	return errors.New("marker write failure")
}

type failOnSecondReplaceLifecycleOps struct {
	base         *fsops.Local
	replaceCalls int
}

func (f *failOnSecondReplaceLifecycleOps) CopyDir(source string, destination string) error {
	return f.base.CopyDir(source, destination)
}

func (f *failOnSecondReplaceLifecycleOps) ReplaceDir(source string, destination string) error {
	f.replaceCalls++
	if f.replaceCalls == 2 {
		return errors.New("forced second replace failure")
	}

	return f.base.ReplaceDir(source, destination)
}

func (f *failOnSecondReplaceLifecycleOps) RemoveDir(path string) error {
	return f.base.RemoveDir(path)
}

type failDeleteActiveCleanupOps struct {
	base *fsops.Local
}

func (f *failDeleteActiveCleanupOps) CopyDir(source string, destination string) error {
	return f.base.CopyDir(source, destination)
}

func (f *failDeleteActiveCleanupOps) ReplaceDir(source string, destination string) error {
	return f.base.ReplaceDir(source, destination)
}

func (f *failDeleteActiveCleanupOps) RemoveDir(path string) error {
	if strings.HasPrefix(filepath.Base(path), "ProfileAlpha.delete-") {
		return errors.New("forced delete cleanup failure")
	}

	return f.base.RemoveDir(path)
}
