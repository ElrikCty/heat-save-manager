//go:build windows

package discovery

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"golang.org/x/sys/windows/registry"
)

var windowsEnvVarPattern = regexp.MustCompile(`%([^%]+)%`)

func detectDocumentsRoot() (string, error) {
	if path, err := readPersonalDocumentsPath(`Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders`, false); err == nil {
		return path, nil
	}

	if path, err := readPersonalDocumentsPath(`Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders`, true); err == nil {
		return path, nil
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(home, "Documents"), nil
}

func readPersonalDocumentsPath(registryKey string, expandVars bool) (string, error) {
	key, err := registry.OpenKey(registry.CURRENT_USER, registryKey, registry.QUERY_VALUE)
	if err != nil {
		return "", err
	}
	defer key.Close()

	raw, _, err := key.GetStringValue("Personal")
	if err != nil {
		return "", err
	}

	resolved := strings.TrimSpace(raw)
	if expandVars {
		resolved = expandWindowsEnvVars(resolved)
	}

	resolved = filepath.Clean(strings.TrimSpace(resolved))
	if resolved == "." || resolved == "" {
		return "", errors.New("documents path is empty")
	}

	return resolved, nil
}

func expandWindowsEnvVars(value string) string {
	return windowsEnvVarPattern.ReplaceAllStringFunc(value, func(token string) string {
		name := strings.Trim(token, "%")
		if name == "" {
			return token
		}

		resolved := os.Getenv(name)
		if resolved == "" {
			return token
		}

		return resolved
	})
}
