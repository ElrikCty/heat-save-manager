//go:build !windows

package updater

import "errors"

func startInstallerElevated(installerPath string) error {
	_ = installerPath
	return errors.New("elevated installer launch is only supported on windows")
}
