package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	AppDirectoryName = "HeatSaveManager"
	FileName         = "config.json"
)

type Store struct {
	configDir string
}

func NewStore() (*Store, error) {
	baseDir, err := os.UserConfigDir()
	if err != nil {
		return nil, err
	}

	return NewStoreWithDir(filepath.Join(baseDir, AppDirectoryName)), nil
}

func NewStoreWithDir(configDir string) *Store {
	return &Store{configDir: configDir}
}

func (s *Store) Path() string {
	return filepath.Join(s.configDir, FileName)
}

func (s *Store) Load() (AppConfig, error) {
	content, err := os.ReadFile(s.Path())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Default(), nil
		}

		return AppConfig{}, err
	}

	var cfg AppConfig
	if err := json.Unmarshal(content, &cfg); err != nil {
		return AppConfig{}, err
	}

	return cfg, nil
}

func (s *Store) Save(cfg AppConfig) error {
	if err := os.MkdirAll(s.configDir, 0o755); err != nil {
		return err
	}

	content, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}

	tmpPath := s.Path() + ".tmp-" + strings.ReplaceAll(time.Now().UTC().Format("20060102-150405.000000000"), ".", "")
	if err := os.WriteFile(tmpPath, content, 0o644); err != nil {
		return err
	}

	if err := os.Rename(tmpPath, s.Path()); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}

	return nil
}
