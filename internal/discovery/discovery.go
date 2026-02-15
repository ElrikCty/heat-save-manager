package discovery

import (
	"errors"
	"path/filepath"
)

var ErrDocumentsRootRequired = errors.New("documents root is required")

type Paths struct {
	SaveGamePath string
	ProfilesPath string
}

type Locator interface {
	Locate() (Paths, error)
}

type Service struct {
	documentsRoot string
}

func NewService(documentsRoot string) *Service {
	return &Service{documentsRoot: documentsRoot}
}

func (s *Service) Locate() (Paths, error) {
	if s.documentsRoot == "" {
		return Paths{}, ErrDocumentsRootRequired
	}

	saveGamePath := filepath.Join(s.documentsRoot, "Need for speed heat", "SaveGame")
	profilesPath := filepath.Join(saveGamePath, "Profiles")

	return Paths{
		SaveGamePath: saveGamePath,
		ProfilesPath: profilesPath,
	}, nil
}
