package profiles

import (
	"errors"
	"os"
	"path/filepath"
	"sort"
)

var (
	ErrProfilesPathRequired = errors.New("profiles path is required")
	ErrInvalidProfileLayout = errors.New("profile must contain savegame and wraps folders")
)

type Profile struct {
	Name string
	Path string
}

type Service struct {
	profilesPath string
}

func NewService(profilesPath string) *Service {
	return &Service{profilesPath: profilesPath}
}

func (s *Service) List() ([]Profile, error) {
	if s.profilesPath == "" {
		return nil, ErrProfilesPathRequired
	}

	if err := os.MkdirAll(s.profilesPath, 0o755); err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(s.profilesPath)
	if err != nil {
		return nil, err
	}

	items := make([]Profile, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		profilePath := filepath.Join(s.profilesPath, entry.Name())
		if err := ValidateLayout(profilePath); err != nil {
			continue
		}

		items = append(items, Profile{
			Name: entry.Name(),
			Path: profilePath,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].Name < items[j].Name
	})

	return items, nil
}

func ValidateLayout(profilePath string) error {
	if hasRequiredDir(profilePath, "savegame") && hasRequiredDir(profilePath, "wraps") {
		return nil
	}

	return ErrInvalidProfileLayout
}

func hasRequiredDir(parent string, name string) bool {
	info, err := os.Stat(filepath.Join(parent, name))
	if err != nil {
		return false
	}

	return info.IsDir()
}
