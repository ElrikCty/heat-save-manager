//go:build !windows

package discovery

import (
	"os"
	"path/filepath"
)

func detectDocumentsRoot() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(home, "Documents"), nil
}
