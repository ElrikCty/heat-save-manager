package bundle

import (
	"archive/zip"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"heat-save-manager/internal/profiles"
)

var (
	ErrProfilesPathRequired = errors.New("profiles path is required")
	ErrProfileNameRequired  = errors.New("profile name is required")
	ErrBundlePathRequired   = errors.New("bundle path is required")
	ErrInvalidProfileName   = errors.New("profile name contains invalid characters")
)

type Service struct {
	profilesPath string
}

func NewService(profilesPath string) *Service {
	return &Service{profilesPath: profilesPath}
}

func (s *Service) ExportProfile(profileName string, bundlePath string) error {
	name, err := validateProfileName(profileName)
	if err != nil {
		return err
	}

	if strings.TrimSpace(bundlePath) == "" {
		return ErrBundlePathRequired
	}

	if strings.TrimSpace(s.profilesPath) == "" {
		return ErrProfilesPathRequired
	}

	profileRoot := filepath.Join(s.profilesPath, name)
	if err := profiles.ValidateLayout(profileRoot); err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(bundlePath), 0o755); err != nil {
		return err
	}

	file, err := os.Create(bundlePath)
	if err != nil {
		return err
	}
	defer file.Close()

	archive := zip.NewWriter(file)
	defer archive.Close()

	return filepath.WalkDir(profileRoot, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}

		if d.IsDir() {
			return nil
		}

		relPath, err := filepath.Rel(profileRoot, path)
		if err != nil {
			return err
		}

		entryName := filepath.ToSlash(relPath)
		info, err := d.Info()
		if err != nil {
			return err
		}

		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		header.Name = entryName
		header.Method = zip.Deflate

		writer, err := archive.CreateHeader(header)
		if err != nil {
			return err
		}

		in, err := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()

		_, err = io.Copy(writer, in)
		return err
	})
}

func (s *Service) ImportProfile(profileName string, bundlePath string) error {
	name, err := validateProfileName(profileName)
	if err != nil {
		return err
	}

	if strings.TrimSpace(bundlePath) == "" {
		return ErrBundlePathRequired
	}

	if strings.TrimSpace(s.profilesPath) == "" {
		return ErrProfilesPathRequired
	}

	reader, err := zip.OpenReader(bundlePath)
	if err != nil {
		return err
	}
	defer reader.Close()

	profileRoot := filepath.Join(s.profilesPath, name)
	if err := os.RemoveAll(profileRoot); err != nil {
		return err
	}

	if err := os.MkdirAll(profileRoot, 0o755); err != nil {
		return err
	}

	for _, f := range reader.File {
		targetPath := filepath.Join(profileRoot, filepath.FromSlash(f.Name))
		if !strings.HasPrefix(filepath.Clean(targetPath), filepath.Clean(profileRoot)+string(os.PathSeparator)) {
			return errors.New("bundle contains invalid file path")
		}

		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(targetPath, 0o755); err != nil {
				return err
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return err
		}

		in, err := f.Open()
		if err != nil {
			return err
		}

		out, err := os.OpenFile(targetPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, f.Mode())
		if err != nil {
			in.Close()
			return err
		}

		if _, err := io.Copy(out, in); err != nil {
			in.Close()
			out.Close()
			return err
		}

		if err := in.Close(); err != nil {
			out.Close()
			return err
		}

		if err := out.Close(); err != nil {
			return err
		}
	}

	return profiles.ValidateLayout(profileRoot)
}

func validateProfileName(profileName string) (string, error) {
	trimmed := strings.TrimSpace(profileName)
	if trimmed == "" {
		return "", ErrProfileNameRequired
	}

	if strings.ContainsAny(trimmed, `<>:"/\\|?*`) {
		return "", ErrInvalidProfileName
	}

	if strings.HasSuffix(trimmed, ".") || strings.HasSuffix(trimmed, " ") {
		return "", ErrInvalidProfileName
	}

	return trimmed, nil
}
