package updater

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	defaultUserAgent      = "heat-save-manager-in-app-updater"
	defaultRequestTimeout = 2 * time.Minute
	defaultMaxBytes       = 512 << 20
	progressEmitInterval  = 200 * time.Millisecond
)

type Result struct {
	Started     bool
	Message     string
	FallbackURL string
}

type Progress struct {
	Stage           string
	Message         string
	DownloadedBytes int64
	TotalBytes      int64
	Percent         int
}

type Launcher interface {
	Start(installerPath string) error
}

type Service struct {
	client           *http.Client
	launcher         Launcher
	tempRoot         string
	maxDownloadBytes int64
	now              func() time.Time
	onProgress       func(Progress)
}

func NewService(tempRoot string, launcher Launcher) *Service {
	if strings.TrimSpace(tempRoot) == "" {
		tempRoot = filepath.Join(os.TempDir(), "HeatSaveManager", "updates")
	}

	if launcher == nil {
		launcher = execLauncher{}
	}

	return &Service{
		client:           &http.Client{Timeout: defaultRequestTimeout},
		launcher:         launcher,
		tempRoot:         tempRoot,
		maxDownloadBytes: defaultMaxBytes,
		now:              time.Now,
	}
}

func (s *Service) SetProgressCallback(callback func(Progress)) {
	s.onProgress = callback
}

func (s *Service) Start(ctx context.Context, downloadURL string, releaseURL string) (Result, error) {
	fallback := preferredFallbackURL(releaseURL, downloadURL)
	s.emitProgress("validating", "Validating update package...")

	installerURL, err := validateInstallerURL(downloadURL)
	if err != nil {
		s.emitProgress("failed", "Update validation failed.")
		return Result{}, err
	}

	s.emitProgress("downloading", "Downloading installer update...")

	installerPath, err := s.downloadInstaller(ctx, installerURL)
	if err != nil {
		s.emitProgress("failed", "Failed to download installer update.")
		return Result{}, err
	}

	s.emitProgress("downloaded", "Installer downloaded. Launching installer...")
	s.emitProgress("launching", "Launching installer... approve the Windows prompt if asked.")

	if err := s.launcher.Start(installerPath); err != nil {
		s.emitProgress("failed", "Failed to launch installer.")
		return Result{}, fmt.Errorf("launch installer: %w", err)
	}

	s.emitProgress("launched", "Installer launched. Closing app to finish update...")

	return Result{
		Started:     true,
		Message:     "Installer launched. Closing app to finish update...",
		FallbackURL: fallback,
	}, nil
}

func (s *Service) emitProgress(stage string, message string) {
	s.emitProgressWithData(stage, message, 0, 0, -1)
}

func (s *Service) emitProgressWithData(stage string, message string, downloadedBytes int64, totalBytes int64, percent int) {
	if s.onProgress == nil {
		return
	}

	s.onProgress(Progress{
		Stage:           stage,
		Message:         message,
		DownloadedBytes: downloadedBytes,
		TotalBytes:      totalBytes,
		Percent:         percent,
	})
}

func (s *Service) downloadInstaller(ctx context.Context, installerURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, installerURL, nil)
	if err != nil {
		return "", fmt.Errorf("create installer request: %w", err)
	}

	req.Header.Set("User-Agent", defaultUserAgent)

	resp, err := s.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("download installer: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download installer failed: %s", resp.Status)
	}

	contentLength := resp.ContentLength
	if contentLength > s.maxDownloadBytes {
		return "", fmt.Errorf("installer download exceeds %d MB limit", s.maxDownloadBytes/(1024*1024))
	}

	if err := os.MkdirAll(s.tempRoot, 0o755); err != nil {
		return "", fmt.Errorf("prepare updater temp directory: %w", err)
	}

	installerTempDir, err := os.MkdirTemp(s.tempRoot, "installer-")
	if err != nil {
		return "", fmt.Errorf("prepare installer temp directory: %w", err)
	}

	fileName := resolvedInstallerFileName(resp.Request.URL)
	targetPath := filepath.Join(installerTempDir, fileName)

	file, err := os.OpenFile(targetPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o700)
	if err != nil {
		_ = os.Remove(installerTempDir)
		return "", fmt.Errorf("create installer file: %w", err)
	}

	limited := &io.LimitedReader{R: resp.Body, N: s.maxDownloadBytes + 1}
	buffer := make([]byte, 64*1024)
	var written int64
	var lastProgress time.Time

	for {
		readBytes, readErr := limited.Read(buffer)
		if readBytes > 0 {
			writeBytes, writeErr := file.Write(buffer[:readBytes])
			if writeErr != nil {
				_ = file.Close()
				removeInstallerArtifacts(targetPath)
				return "", fmt.Errorf("write installer file: %w", writeErr)
			}

			if writeBytes != readBytes {
				_ = file.Close()
				removeInstallerArtifacts(targetPath)
				return "", io.ErrShortWrite
			}

			written += int64(writeBytes)
			now := s.now().UTC()
			if lastProgress.IsZero() || now.Sub(lastProgress) >= progressEmitInterval {
				lastProgress = now
				s.emitDownloadProgress(written, contentLength)
			}
		}

		if readErr == io.EOF {
			break
		}

		if readErr != nil {
			_ = file.Close()
			removeInstallerArtifacts(targetPath)
			return "", fmt.Errorf("write installer file: %w", readErr)
		}
	}

	s.emitDownloadProgress(written, contentLength)

	if syncErr := file.Sync(); syncErr != nil {
		_ = file.Close()
		removeInstallerArtifacts(targetPath)
		return "", fmt.Errorf("sync installer file: %w", syncErr)
	}

	if closeErr := file.Close(); closeErr != nil {
		removeInstallerArtifacts(targetPath)
		return "", fmt.Errorf("close installer file: %w", closeErr)
	}

	if written > s.maxDownloadBytes {
		removeInstallerArtifacts(targetPath)
		return "", fmt.Errorf("installer download exceeds %d MB limit", s.maxDownloadBytes/(1024*1024))
	}

	return targetPath, nil
}

func removeInstallerArtifacts(path string) {
	if strings.TrimSpace(path) == "" {
		return
	}

	_ = os.Remove(path)
	_ = os.Remove(filepath.Dir(path))
}

func (s *Service) emitDownloadProgress(downloadedBytes int64, totalBytes int64) {
	message := fmt.Sprintf("Downloading installer update... %s", formatBytes(downloadedBytes))
	percent := -1

	if totalBytes > 0 {
		if downloadedBytes > totalBytes {
			downloadedBytes = totalBytes
		}

		percent = int((downloadedBytes * 100) / totalBytes)
		if percent > 100 {
			percent = 100
		}

		message = fmt.Sprintf("Downloading installer update... %s / %s (%d%%)", formatBytes(downloadedBytes), formatBytes(totalBytes), percent)
	}

	s.emitProgressWithData("downloading", message, downloadedBytes, totalBytes, percent)
}

func formatBytes(size int64) string {
	if size < 1024 {
		return fmt.Sprintf("%d B", size)
	}

	if size < 1024*1024 {
		return fmt.Sprintf("%.1f KB", float64(size)/1024)
	}

	if size < 1024*1024*1024 {
		return fmt.Sprintf("%.1f MB", float64(size)/(1024*1024))
	}

	return fmt.Sprintf("%.2f GB", float64(size)/(1024*1024*1024))
}

func preferredFallbackURL(releaseURL string, downloadURL string) string {
	if trimmed := strings.TrimSpace(releaseURL); trimmed != "" {
		return trimmed
	}

	return strings.TrimSpace(downloadURL)
}

func validateInstallerURL(rawURL string) (string, error) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return "", errors.New("update download url is required")
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", errors.New("invalid update download url")
	}

	if parsed.Scheme != "https" {
		return "", errors.New("update download url must use https")
	}

	name := strings.ToLower(filepath.Base(parsed.Path))
	if !strings.HasSuffix(name, "-installer.exe") {
		return "", errors.New("direct update requires a windows installer asset")
	}

	return trimmed, nil
}

func resolvedInstallerFileName(parsed *url.URL) string {
	if parsed != nil {
		name := sanitizeFileName(filepath.Base(parsed.Path))
		if strings.HasSuffix(strings.ToLower(name), ".exe") {
			return name
		}
	}

	return "HeatSaveManager-installer.exe"
}

func sanitizeFileName(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "HeatSaveManager-installer.exe"
	}

	b := strings.Builder{}
	for _, r := range trimmed {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '-' || r == '_' {
			b.WriteRune(r)
			continue
		}
		b.WriteRune('_')
	}

	result := b.String()
	if result == "" {
		return "HeatSaveManager-installer.exe"
	}

	return result
}

type execLauncher struct{}

func (e execLauncher) Start(installerPath string) error {
	if runtime.GOOS == "windows" {
		return startInstallerElevated(installerPath)
	}

	cmd := exec.Command(installerPath)
	return cmd.Start()
}
