package updater

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type launcherStub struct {
	startedPath string
	err         error
}

func (l *launcherStub) Start(path string) error {
	l.startedPath = path
	return l.err
}

func TestStartDownloadsAndLaunchesInstaller(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("installer-bytes"))
	}))
	defer server.Close()

	launcher := &launcherStub{}
	tempRoot := t.TempDir()

	svc := NewService(tempRoot, launcher)
	svc.client = server.Client()
	svc.now = func() time.Time { return time.Unix(1700000000, 0) }

	var stages []string
	var observedDownloadBytes int64
	svc.SetProgressCallback(func(progress Progress) {
		stages = append(stages, progress.Stage)
		if progress.Stage == "downloading" && progress.DownloadedBytes > observedDownloadBytes {
			observedDownloadBytes = progress.DownloadedBytes
		}
	})

	result, err := svc.Start(context.Background(), server.URL+"/HeatSaveManager-v1.0.5-windows-x64-installer.exe", server.URL+"/release")
	if err != nil {
		t.Fatalf("Start returned error: %v", err)
	}

	if !result.Started {
		t.Fatalf("expected result.Started to be true")
	}

	if launcher.startedPath == "" {
		t.Fatalf("expected launcher to receive installer path")
	}

	if !strings.HasPrefix(launcher.startedPath, tempRoot) {
		t.Fatalf("expected installer path under temp root, got %q", launcher.startedPath)
	}

	if !strings.HasSuffix(strings.ToLower(filepath.Base(launcher.startedPath)), "-installer.exe") {
		t.Fatalf("expected installer filename, got %q", launcher.startedPath)
	}

	if filepath.Base(launcher.startedPath) != "HeatSaveManager-v1.0.5-windows-x64-installer.exe" {
		t.Fatalf("expected canonical installer basename, got %q", filepath.Base(launcher.startedPath))
	}

	if result.FallbackURL != server.URL+"/release" {
		t.Fatalf("expected fallback URL to be release URL, got %q", result.FallbackURL)
	}

	if len(stages) < 5 {
		t.Fatalf("expected at least 5 progress events, got %v", stages)
	}

	if stages[0] != "validating" {
		t.Fatalf("expected first progress stage to be validating, got %q", stages[0])
	}

	if stages[len(stages)-1] != "launched" {
		t.Fatalf("expected final progress stage to be launched, got %q", stages[len(stages)-1])
	}

	if observedDownloadBytes <= 0 {
		t.Fatalf("expected download byte progress to be reported, got %d", observedDownloadBytes)
	}
}

func TestStartRejectsNonInstallerAsset(t *testing.T) {
	svc := NewService(t.TempDir(), &launcherStub{})

	_, err := svc.Start(context.Background(), "https://example.com/HeatSaveManager-v1.0.5-windows-x64.zip", "https://example.com/release")
	if err == nil {
		t.Fatalf("expected an error for non-installer asset")
	}
}

func TestStartRejectsNonHTTPSInstallerURL(t *testing.T) {
	svc := NewService(t.TempDir(), &launcherStub{})

	_, err := svc.Start(context.Background(), "http://example.com/HeatSaveManager-v1.0.5-windows-x64-installer.exe", "https://example.com/release")
	if err == nil {
		t.Fatalf("expected an error for non-https installer url")
	}

	if !strings.Contains(strings.ToLower(err.Error()), "https") {
		t.Fatalf("expected https validation error, got %q", err)
	}
}

func TestStartFailsWhenLauncherFails(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("installer-bytes"))
	}))
	defer server.Close()

	launcher := &launcherStub{err: errors.New("launch blocked")}
	svc := NewService(t.TempDir(), launcher)
	svc.client = server.Client()

	var stages []string
	svc.SetProgressCallback(func(progress Progress) {
		stages = append(stages, progress.Stage)
	})

	_, err := svc.Start(context.Background(), server.URL+"/HeatSaveManager-v1.0.5-windows-x64-installer.exe", "")
	if err == nil {
		t.Fatalf("expected launch error")
	}

	if !strings.Contains(err.Error(), "launch installer") {
		t.Fatalf("expected launch context in error, got %q", err)
	}

	if len(stages) == 0 || stages[len(stages)-1] != "failed" {
		t.Fatalf("expected failed stage, got %v", stages)
	}
}

func TestStartFailsWhenDownloadExceedsLimit(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("this-is-bigger-than-limit"))
	}))
	defer server.Close()

	svc := NewService(t.TempDir(), &launcherStub{})
	svc.client = server.Client()
	svc.maxDownloadBytes = 4

	_, err := svc.Start(context.Background(), server.URL+"/HeatSaveManager-v1.0.5-windows-x64-installer.exe", "")
	if err == nil {
		t.Fatalf("expected limit error")
	}

	if !strings.Contains(err.Error(), "exceeds") {
		t.Fatalf("expected size limit error, got %q", err)
	}
}

func TestBuildInstallerArgumentsWithoutInstallDir(t *testing.T) {
	arguments := buildInstallerArguments("")
	if arguments != "/S /AUTORESTARTAPP" {
		t.Fatalf("expected base installer arguments, got %q", arguments)
	}
}

func TestBuildInstallerArgumentsWithInstallDir(t *testing.T) {
	arguments := buildInstallerArguments(` C:\Program Files\Eduardo Baltra\Heat Save Manager `)
	wanted := `/S /AUTORESTARTAPP /D=C:\Program Files\Eduardo Baltra\Heat Save Manager`
	if arguments != wanted {
		t.Fatalf("expected %q, got %q", wanted, arguments)
	}
}
