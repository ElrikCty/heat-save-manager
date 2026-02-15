package lifecycle

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"heat-save-manager/internal/fsops"
)

var (
	ErrProfileNameRequired       = errors.New("profile name is required")
	ErrProfileNameInvalid        = errors.New("profile name contains invalid characters")
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
	name, err := validateProfileName(profileName)
	if err != nil {
		return err
	}

	if err := s.validateDependencies(); err != nil {
		return err
	}

	if err := s.ops.RemoveDir(filepath.Join(s.saveGamePath, savegameDirName)); err != nil {
		return err
	}

	if err := s.ops.RemoveDir(filepath.Join(s.saveGamePath, wrapsDirName)); err != nil {
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

	targetRoot := filepath.Join(s.profilesPath, name)
	if err := s.ops.ReplaceDir(filepath.Join(s.saveGamePath, savegameDirName), filepath.Join(targetRoot, savegameDirName)); err != nil {
		return err
	}

	if err := s.ops.ReplaceDir(filepath.Join(s.saveGamePath, wrapsDirName), filepath.Join(targetRoot, wrapsDirName)); err != nil {
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

	if strings.TrimSpace(active) == oldTrimmed {
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
	if err == nil && strings.TrimSpace(active) == name {
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
