package bundle

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"heat-save-manager/internal/profiles"
)

var (
	ErrProfilesPathRequired = errors.New("profiles path is required")
	ErrProfileNameRequired  = errors.New("profile name is required")
	ErrBundlePathRequired   = errors.New("bundle path is required")
	ErrInvalidProfileName   = errors.New("profile name contains invalid characters")
	ErrBundleTooLarge       = errors.New("bundle exceeds import safety limits")
)

var (
	maxBundleEntries          = 10_000
	maxBundleFileBytes  int64 = 256 << 20
	maxBundleTotalBytes int64 = 2 << 30
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

		_, copyErr := io.Copy(writer, in)
		closeErr := in.Close()
		if copyErr != nil {
			return copyErr
		}

		return closeErr
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

	if err := os.MkdirAll(s.profilesPath, 0o755); err != nil {
		return err
	}

	profileRoot := filepath.Join(s.profilesPath, name)
	stagingRoot, err := os.MkdirTemp(s.profilesPath, name+".import-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stagingRoot)

	if err := extractBundleToProfileRoot(reader.File, stagingRoot); err != nil {
		return err
	}

	if err := profiles.ValidateLayout(stagingRoot); err != nil {
		return err
	}

	return replaceProfileRootAtomic(profileRoot, stagingRoot)
}

func extractBundleToProfileRoot(files []*zip.File, profileRoot string) error {
	if len(files) > maxBundleEntries {
		return ErrBundleTooLarge
	}

	root := filepath.Clean(profileRoot)
	rootPrefix := root + string(os.PathSeparator)
	var totalUncompressedBytes int64

	for _, f := range files {
		targetPath := filepath.Join(profileRoot, filepath.FromSlash(f.Name))
		cleanTargetPath := filepath.Clean(targetPath)
		if cleanTargetPath != root && !strings.HasPrefix(cleanTargetPath, rootPrefix) {
			return errors.New("bundle contains invalid file path")
		}

		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(cleanTargetPath, 0o755); err != nil {
				return err
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(cleanTargetPath), 0o755); err != nil {
			return err
		}

		in, err := f.Open()
		if err != nil {
			return err
		}

		out, err := os.OpenFile(cleanTargetPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, f.Mode())
		if err != nil {
			in.Close()
			return err
		}

		limited := &io.LimitedReader{R: in, N: maxBundleFileBytes + 1}
		written, copyErr := io.Copy(out, limited)
		if copyErr != nil {
			in.Close()
			out.Close()
			return copyErr
		}

		if written > maxBundleFileBytes {
			in.Close()
			out.Close()
			return ErrBundleTooLarge
		}

		totalUncompressedBytes += written
		if totalUncompressedBytes > maxBundleTotalBytes {
			in.Close()
			out.Close()
			return ErrBundleTooLarge
		}

		if err := in.Close(); err != nil {
			out.Close()
			return err
		}

		if err := out.Close(); err != nil {
			return err
		}
	}

	return nil
}

func replaceProfileRootAtomic(profileRoot string, stagingRoot string) error {
	backupRoot := profileRoot + ".backup-" + time.Now().UTC().Format("20060102-150405.000000000")
	hadExisting := false

	if info, err := os.Stat(profileRoot); err == nil {
		if !info.IsDir() {
			return fmt.Errorf("profile path exists but is not a directory: %s", profileRoot)
		}
		hadExisting = true
		if err := os.RemoveAll(backupRoot); err != nil {
			return err
		}
		if err := os.Rename(profileRoot, backupRoot); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	}

	if err := os.Rename(stagingRoot, profileRoot); err != nil {
		if hadExisting {
			if rollbackErr := os.Rename(backupRoot, profileRoot); rollbackErr != nil {
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
