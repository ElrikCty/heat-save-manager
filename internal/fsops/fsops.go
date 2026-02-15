package fsops

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var ErrSourceMustBeDirectory = fmt.Errorf("source must be a directory")

type Operations interface {
	CopyDir(source string, destination string) error
	ReplaceDir(source string, destination string) error
	RemoveDir(path string) error
}

type Local struct{}

func NewLocal() *Local {
	return &Local{}
}

func (l *Local) CopyDir(source string, destination string) error {
	info, err := os.Stat(source)
	if err != nil {
		return err
	}

	if !info.IsDir() {
		return ErrSourceMustBeDirectory
	}

	if err := os.MkdirAll(destination, info.Mode().Perm()); err != nil {
		return err
	}

	return filepath.WalkDir(source, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}

		relPath, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}

		if relPath == "." {
			return nil
		}

		targetPath := filepath.Join(destination, relPath)
		entryInfo, err := d.Info()
		if err != nil {
			return err
		}

		if d.IsDir() {
			return os.MkdirAll(targetPath, entryInfo.Mode().Perm())
		}

		if d.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlinks are not supported: %s", path)
		}

		if err := copyFile(path, targetPath, entryInfo.Mode().Perm()); err != nil {
			return err
		}

		return nil
	})
}

func (l *Local) ReplaceDir(source string, destination string) error {
	parentDir := filepath.Dir(destination)
	if err := os.MkdirAll(parentDir, 0o755); err != nil {
		return err
	}

	tmpDir := destination + ".replace-" + strings.ReplaceAll(time.Now().UTC().Format("20060102-150405.000000000"), ".", "")
	if err := os.RemoveAll(tmpDir); err != nil {
		return err
	}

	if err := l.CopyDir(source, tmpDir); err != nil {
		return err
	}

	if err := os.RemoveAll(destination); err != nil {
		_ = os.RemoveAll(tmpDir)
		return err
	}

	if err := os.Rename(tmpDir, destination); err != nil {
		_ = os.RemoveAll(tmpDir)
		return err
	}

	return nil
}

func (l *Local) RemoveDir(path string) error {
	return os.RemoveAll(path)
}

func copyFile(source string, destination string, mode os.FileMode) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()

	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return err
	}

	out, err := os.OpenFile(destination, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return err
	}

	return out.Sync()
}
