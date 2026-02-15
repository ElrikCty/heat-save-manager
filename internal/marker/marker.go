package marker

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"heat-save-manager/internal/config"
)

var ErrProfileNameRequired = errors.New("profile name is required")

type Store struct {
	saveGamePath string
}

func NewStore(saveGamePath string) *Store {
	return &Store{saveGamePath: saveGamePath}
}

func (s *Store) Path() string {
	return filepath.Join(s.saveGamePath, config.MarkerFileName)
}

func (s *Store) ReadActiveProfile() (string, error) {
	content, err := os.ReadFile(s.Path())
	if err != nil {
		return "", err
	}

	return strings.TrimSpace(string(content)), nil
}

func (s *Store) WriteActiveProfile(profileName string) error {
	trimmed := strings.TrimSpace(profileName)
	if trimmed == "" {
		return ErrProfileNameRequired
	}

	return os.WriteFile(s.Path(), []byte(trimmed+"\n"), 0o644)
}
