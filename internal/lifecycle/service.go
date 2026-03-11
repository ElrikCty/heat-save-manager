package lifecycle

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"heat-save-manager/internal/fsops"
	"heat-save-manager/internal/switcher"
)

var (
	ErrProfileNameRequired       = errors.New("profile name is required")
	ErrProfileNameInvalid        = errors.New("profile name contains invalid characters")
	ErrActiveProfileRequired     = errors.New("active profile marker is required to preserve current progress")
	ErrFreshProfileNameConflict  = errors.New("new profile name must differ from active profile when preserving current progress")
	ErrSaveGamePathRequired      = errors.New("savegame path is required")
	ErrProfilesPathRequired      = errors.New("profiles path is required")
	ErrMarkerStoreRequired       = errors.New("marker store is required")
	ErrFileOperationsRequired    = errors.New("file operations are required")
	ErrRootSavegameMissing       = errors.New("root savegame folder is missing")
	ErrRootWrapsMissing          = errors.New("root wraps folder is missing")
	ErrCannotDeleteActiveProfile = errors.New("cannot delete active profile")
	ErrProfileAlreadyExists      = errors.New("profile already exists")
	ErrProfileNotFound           = errors.New("profile not found")
)

const (
	savegameDirName = "savegame"
	wrapsDirName    = "wraps"
)

type MarkerStore interface {
	ReadActiveProfile() (string, error)
	WriteActiveProfile(profileName string) error
}

type Service struct {
	saveGamePath string
	profilesPath string
	marker       MarkerStore
	ops          fsops.Operations
}

func NewService(saveGamePath string, profilesPath string, marker MarkerStore, ops fsops.Operations) *Service {
	return &Service{
		saveGamePath: saveGamePath,
		profilesPath: profilesPath,
		marker:       marker,
		ops:          ops,
	}
}

func (s *Service) PrepareFreshProfile(profileName string) error {
	return s.prepareFreshProfile(profileName, true)
}

func (s *Service) PrepareFreshProfileWithoutSave(profileName string) error {
	return s.prepareFreshProfile(profileName, false)
}

func (s *Service) prepareFreshProfile(profileName string, preserveCurrent bool) error {
	name, err := validateProfileName(profileName)
	if err != nil {
		return err
	}

	if err := s.validateDependencies(); err != nil {
		return err
	}

	activeName := ""
	if preserveCurrent {
		activeProfile, err := s.marker.ReadActiveProfile()
		if err != nil {
			if os.IsNotExist(err) {
				return ErrActiveProfileRequired
			}

			return err
		}

		activeName, err = validateProfileName(activeProfile)
		if err != nil {
			return ErrActiveProfileRequired
		}

		if strings.EqualFold(activeName, name) {
			return ErrFreshProfileNameConflict
		}
	}

	if err := s.ensureFreshProfileDoesNotExist(name); err != nil {
		return err
	}

	if preserveCurrent {
		if err := s.SaveCurrentProfile(activeName); err != nil {
			return err
		}
	}

	if err := clearDirContents(filepath.Join(s.saveGamePath, savegameDirName)); err != nil {
		return err
	}

	if err := clearDirContents(filepath.Join(s.saveGamePath, wrapsDirName)); err != nil {
		return err
	}

	if err := s.SaveCurrentProfile(name); err != nil {
		return err
	}

	return s.marker.WriteActiveProfile(name)
}

func (s *Service) SaveCurrentProfile(profileName string) error {
	if err := s.validateDependencies(); err != nil {
		return err
	}

	name, err := s.resolveProfileName(profileName)
	if err != nil {
		return err
	}

	if err := ensureDirExists(filepath.Join(s.saveGamePath, savegameDirName)); err != nil {
		if os.IsNotExist(err) {
			return ErrRootSavegameMissing
		}
		return err
	}

	if err := ensureDirExists(filepath.Join(s.saveGamePath, wrapsDirName)); err != nil {
		if os.IsNotExist(err) {
			return ErrRootWrapsMissing
		}
		return err
	}

	if err := os.MkdirAll(s.profilesPath, 0o755); err != nil {
		return err
	}

	stagingRoot, err := os.MkdirTemp(s.profilesPath, name+".save-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stagingRoot)

	if err := s.ops.ReplaceDir(filepath.Join(s.saveGamePath, savegameDirName), filepath.Join(stagingRoot, savegameDirName)); err != nil {
		return err
	}

	if err := s.ops.ReplaceDir(filepath.Join(s.saveGamePath, wrapsDirName), filepath.Join(stagingRoot, wrapsDirName)); err != nil {
		return err
	}

	if err := replaceProfileRootAtomic(filepath.Join(s.profilesPath, name), stagingRoot); err != nil {
		return err
	}

	return nil
}

func (s *Service) RenameProfile(oldName string, newName string) error {
	if err := s.validateDependencies(); err != nil {
		return err
	}

	oldTrimmed, err := validateProfileName(oldName)
	if err != nil {
		return err
	}

	newTrimmed, err := validateProfileName(newName)
	if err != nil {
		return err
	}

	oldPath := filepath.Join(s.profilesPath, oldTrimmed)
	newPath := filepath.Join(s.profilesPath, newTrimmed)

	if err := ensureDirExists(oldPath); err != nil {
		if os.IsNotExist(err) {
			return ErrProfileNotFound
		}
		return err
	}

	if _, err := os.Stat(newPath); err == nil {
		return ErrProfileAlreadyExists
	} else if !os.IsNotExist(err) {
		return err
	}

	if err := os.Rename(oldPath, newPath); err != nil {
		return err
	}

	active, err := s.marker.ReadActiveProfile()
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	if strings.EqualFold(strings.TrimSpace(active), oldTrimmed) {
		if err := s.marker.WriteActiveProfile(newTrimmed); err != nil {
			_ = os.Rename(newPath, oldPath)
			return err
		}
	}

	return nil
}

func (s *Service) DeleteProfile(profileName string) error {
	if err := s.validateDependencies(); err != nil {
		return err
	}

	name, err := validateProfileName(profileName)
	if err != nil {
		return err
	}

	active, err := s.marker.ReadActiveProfile()
	if err == nil && strings.EqualFold(strings.TrimSpace(active), name) {
		return ErrCannotDeleteActiveProfile
	}

	if err != nil && !os.IsNotExist(err) {
		return err
	}

	profilePath := filepath.Join(s.profilesPath, name)
	if err := ensureDirExists(profilePath); err != nil {
		if os.IsNotExist(err) {
			return ErrProfileNotFound
		}
		return err
	}

	return s.ops.RemoveDir(profilePath)
}

func (s *Service) DeleteActiveProfile(replacementProfileName string) error {
	if err := s.validateDependencies(); err != nil {
		return err
	}

	active, err := s.marker.ReadActiveProfile()
	if err != nil {
		if os.IsNotExist(err) {
			return ErrActiveProfileRequired
		}

		return err
	}

	activeName, err := validateProfileName(active)
	if err != nil {
		return ErrActiveProfileRequired
	}

	replacementName, err := validateProfileName(replacementProfileName)
	if err != nil {
		return err
	}

	if strings.EqualFold(activeName, replacementName) {
		return ErrCannotDeleteActiveProfile
	}

	activePath := filepath.Join(s.profilesPath, activeName)
	if err := ensureDirExists(activePath); err != nil {
		if os.IsNotExist(err) {
			return ErrProfileNotFound
		}
		return err
	}

	replacementPath := filepath.Join(s.profilesPath, replacementName)
	if err := ensureDirExists(replacementPath); err != nil {
		if os.IsNotExist(err) {
			return ErrProfileNotFound
		}
		return err
	}

	stagingPath, err := os.MkdirTemp(s.profilesPath, activeName+".delete-*")
	if err != nil {
		return err
	}

	if err := os.Remove(stagingPath); err != nil {
		return err
	}

	if err := os.Rename(activePath, stagingPath); err != nil {
		return err
	}

	switchService := switcher.NewService(s.saveGamePath, s.profilesPath, s.marker, s.ops)
	if _, err := switchService.Switch(switcher.Params{ProfileName: replacementName}); err != nil {
		if rollbackErr := os.Rename(stagingPath, activePath); rollbackErr != nil {
			return fmt.Errorf("delete active profile switch failed: %w; rollback failed: %v", err, rollbackErr)
		}

		return err
	}

	if err := s.ops.RemoveDir(stagingPath); err != nil {
		if rollbackErr := os.Rename(stagingPath, activePath); rollbackErr != nil {
			return fmt.Errorf("delete active profile cleanup failed: %w; restore failed: %v", err, rollbackErr)
		}

		return err
	}

	return nil
}

func (s *Service) resolveProfileName(profileName string) (string, error) {
	trimmed := strings.TrimSpace(profileName)
	if trimmed != "" {
		return validateProfileName(trimmed)
	}

	active, err := s.marker.ReadActiveProfile()
	if err != nil {
		return "", err
	}

	return validateProfileName(active)
}

func (s *Service) ensureFreshProfileDoesNotExist(profileName string) error {
	profilePath := filepath.Join(s.profilesPath, profileName)
	if _, err := os.Stat(profilePath); err == nil {
		return ErrProfileAlreadyExists
	} else if !os.IsNotExist(err) {
		return err
	}

	return nil
}

func (s *Service) validateDependencies() error {
	if strings.TrimSpace(s.saveGamePath) == "" {
		return ErrSaveGamePathRequired
	}

	if strings.TrimSpace(s.profilesPath) == "" {
		return ErrProfilesPathRequired
	}

	if s.marker == nil {
		return ErrMarkerStoreRequired
	}

	if s.ops == nil {
		return ErrFileOperationsRequired
	}

	return nil
}

func validateProfileName(profileName string) (string, error) {
	trimmed := strings.TrimSpace(profileName)
	if trimmed == "" {
		return "", ErrProfileNameRequired
	}

	if strings.ContainsAny(trimmed, `<>:"/\|?*`) {
		return "", ErrProfileNameInvalid
	}

	if strings.HasSuffix(trimmed, ".") || strings.HasSuffix(trimmed, " ") {
		return "", ErrProfileNameInvalid
	}

	return trimmed, nil
}

func ensureDirExists(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}

	if !info.IsDir() {
		return fmt.Errorf("expected directory: %s", path)
	}

	return nil
}

func clearDirContents(path string) error {
	if err := ensureDirExists(path); err != nil {
		return err
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		entryPath := filepath.Join(path, entry.Name())
		if err := os.RemoveAll(entryPath); err != nil {
			return err
		}
	}

	return nil
}

func replaceProfileRootAtomic(targetRoot string, stagingRoot string) error {
	backupRoot := targetRoot + ".backup-" + time.Now().UTC().Format("20060102-150405.000000000")
	hadExisting := false

	if info, err := os.Stat(targetRoot); err == nil {
		if !info.IsDir() {
			return fmt.Errorf("profile path exists but is not a directory: %s", targetRoot)
		}
		hadExisting = true
		if err := os.RemoveAll(backupRoot); err != nil {
			return err
		}
		if err := os.Rename(targetRoot, backupRoot); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}

	if err := os.Rename(stagingRoot, targetRoot); err != nil {
		if hadExisting {
			if rollbackErr := os.Rename(backupRoot, targetRoot); rollbackErr != nil {
				return fmt.Errorf("replace profile failed: %w; rollback failed: %v", err, rollbackErr)
			}
		}

		return err
	}

	if hadExisting {
		if err := os.RemoveAll(backupRoot); err != nil {
			return err
		}
	}

	return nil
}
