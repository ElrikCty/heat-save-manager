package switcher

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"heat-save-manager/internal/fsops"
	"heat-save-manager/internal/profiles"
)

var (
	ErrProfileNameRequired  = errors.New("profile name is required")
	ErrSaveGamePathRequired = errors.New("savegame path is required")
	ErrProfilesPathRequired = errors.New("profiles path is required")
)

const (
	savegameDirName = "savegame"
	wrapsDirName    = "wraps"
)

type Params struct {
	ProfileName string
}

type Result struct {
	ProfileName string
	SwitchedAt  time.Time
	RolledBack  bool
}

type MarkerWriter interface {
	WriteActiveProfile(profileName string) error
}

type Service struct {
	saveGamePath string
	profilesPath string
	marker       MarkerWriter
	ops          fsops.Operations
	now          func() time.Time
}

func NewService(saveGamePath string, profilesPath string, marker MarkerWriter, ops fsops.Operations) *Service {
	return &Service{
		saveGamePath: saveGamePath,
		profilesPath: profilesPath,
		marker:       marker,
		ops:          ops,
		now:          time.Now,
	}
}

func (s *Service) Switch(params Params) (Result, error) {
	profileName := strings.TrimSpace(params.ProfileName)
	if profileName == "" {
		return Result{}, ErrProfileNameRequired
	}

	if s.saveGamePath == "" {
		return Result{}, ErrSaveGamePathRequired
	}

	if s.profilesPath == "" {
		return Result{}, ErrProfilesPathRequired
	}

	if s.marker == nil {
		return Result{}, errors.New("marker store is required")
	}

	if s.ops == nil {
		return Result{}, errors.New("file operations are required")
	}

	profileRoot := filepath.Join(s.profilesPath, profileName)
	if err := profiles.ValidateLayout(profileRoot); err != nil {
		return Result{}, err
	}

	backupRoot := filepath.Join(s.saveGamePath, ".backup", s.now().UTC().Format("20060102-150405"))
	backupSavegame := filepath.Join(backupRoot, savegameDirName)
	backupWraps := filepath.Join(backupRoot, wrapsDirName)

	hadSavegame, err := s.backupIfExists(filepath.Join(s.saveGamePath, savegameDirName), backupSavegame)
	if err != nil {
		return Result{}, err
	}

	hadWraps, err := s.backupIfExists(filepath.Join(s.saveGamePath, wrapsDirName), backupWraps)
	if err != nil {
		return Result{}, err
	}

	targetSavegame := filepath.Join(s.saveGamePath, savegameDirName)
	targetWraps := filepath.Join(s.saveGamePath, wrapsDirName)
	profileSavegame := filepath.Join(profileRoot, savegameDirName)
	profileWraps := filepath.Join(profileRoot, wrapsDirName)

	if err := s.ops.ReplaceDir(profileSavegame, targetSavegame); err != nil {
		_ = s.ops.RemoveDir(backupRoot)
		return Result{}, err
	}

	if err := s.ops.ReplaceDir(profileWraps, targetWraps); err != nil {
		rollbackErr := s.rollback(targetSavegame, targetWraps, backupSavegame, backupWraps, hadSavegame, hadWraps)
		if rollbackErr != nil {
			return Result{ProfileName: profileName, RolledBack: true}, fmt.Errorf("switch failed: %w; rollback failed: %v", err, rollbackErr)
		}

		return Result{ProfileName: profileName, RolledBack: true}, err
	}

	if err := s.marker.WriteActiveProfile(profileName); err != nil {
		rollbackErr := s.rollback(targetSavegame, targetWraps, backupSavegame, backupWraps, hadSavegame, hadWraps)
		if rollbackErr != nil {
			return Result{ProfileName: profileName, RolledBack: true}, fmt.Errorf("marker update failed: %w; rollback failed: %v", err, rollbackErr)
		}

		return Result{ProfileName: profileName, RolledBack: true}, err
	}

	_ = s.cleanupBackupTree(backupRoot)

	return Result{
		ProfileName: profileName,
		SwitchedAt:  s.now().UTC(),
		RolledBack:  false,
	}, nil
}

func (s *Service) backupIfExists(source string, destination string) (bool, error) {
	info, err := os.Stat(source)
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}

		return false, err
	}

	if !info.IsDir() {
		return false, fmt.Errorf("expected directory: %s", source)
	}

	if err := s.ops.CopyDir(source, destination); err != nil {
		return false, err
	}

	return true, nil
}

func (s *Service) rollback(targetSavegame string, targetWraps string, backupSavegame string, backupWraps string, hadSavegame bool, hadWraps bool) error {
	if err := s.restoreDir(targetSavegame, backupSavegame, hadSavegame); err != nil {
		return err
	}

	if err := s.restoreDir(targetWraps, backupWraps, hadWraps); err != nil {
		return err
	}

	return s.cleanupBackupTree(filepath.Dir(backupSavegame))
}

func (s *Service) restoreDir(target string, backup string, hadOriginal bool) error {
	if hadOriginal {
		return s.ops.ReplaceDir(backup, target)
	}

	return s.ops.RemoveDir(target)
}

func (s *Service) cleanupBackupTree(backupRoot string) error {
	if err := s.ops.RemoveDir(backupRoot); err != nil {
		return err
	}

	backupParent := filepath.Dir(backupRoot)
	entries, err := os.ReadDir(backupParent)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}

		return err
	}

	if len(entries) == 0 {
		if err := s.ops.RemoveDir(backupParent); err != nil {
			return err
		}
	}

	return nil
}
