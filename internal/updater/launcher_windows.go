//go:build windows

package updater

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"
)

const shellExecuteSuccessThreshold = 32

func startInstallerElevated(installerPath string) error {
	trimmedPath := strings.TrimSpace(installerPath)
	if trimmedPath == "" {
		return errors.New("installer path is required")
	}

	if _, err := os.Stat(trimmedPath); err != nil {
		return fmt.Errorf("installer file is unavailable: %w", err)
	}

	verbRunAs, err := syscall.UTF16PtrFromString("runas")
	if err != nil {
		return fmt.Errorf("build runas verb: %w", err)
	}

	filePath, err := syscall.UTF16PtrFromString(trimmedPath)
	if err != nil {
		return fmt.Errorf("build installer path: %w", err)
	}

	argumentsValue := buildInstallerArguments(resolveInstallerInstallDir())
	arguments, err := syscall.UTF16PtrFromString(argumentsValue)
	if err != nil {
		return fmt.Errorf("build installer arguments: %w", err)
	}

	operationResult, _, callErr := procShellExecuteW.Call(
		0,
		uintptr(unsafe.Pointer(verbRunAs)),
		uintptr(unsafe.Pointer(filePath)),
		uintptr(unsafe.Pointer(arguments)),
		0,
		uintptr(swShowDefault),
	)

	if operationResult > shellExecuteSuccessThreshold {
		return nil
	}

	switch operationResult {
	case 0:
		return errors.New("failed to launch installer via ShellExecute")
	case 2:
		return errors.New("installer file was not found")
	case 3:
		return errors.New("installer path was not found")
	case 5:
		return errors.New("requested operation requires elevation or was cancelled by user")
	case 8:
		return errors.New("not enough memory to launch installer")
	case 26:
		return errors.New("cannot execute installer")
	case 27:
		return errors.New("installer association is incomplete")
	case 28:
		return errors.New("installer launch timed out")
	case 31:
		return errors.New("no app is associated to run installer")
	}

	if callErr != nil && callErr != syscall.Errno(0) {
		return fmt.Errorf("shell execute installer: %w", callErr)
	}

	return fmt.Errorf("shell execute installer returned code %d", operationResult)
}

func resolveInstallerInstallDir() string {
	executablePath, err := os.Executable()
	if err != nil {
		return ""
	}

	trimmedExecutablePath := strings.TrimSpace(executablePath)
	if trimmedExecutablePath == "" {
		return ""
	}

	installDir := strings.TrimSpace(filepath.Dir(trimmedExecutablePath))
	if installDir == "" || installDir == "." {
		return ""
	}

	return filepath.Clean(installDir)
}

var (
	modShell32        = syscall.NewLazyDLL("shell32.dll")
	procShellExecuteW = modShell32.NewProc("ShellExecuteW")
)

const swShowDefault = 10
