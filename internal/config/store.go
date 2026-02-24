package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
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

	return os.WriteFile(s.Path(), content, 0o644)
}
