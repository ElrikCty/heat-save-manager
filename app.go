package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"heat-save-manager/internal/bundle"
	"heat-save-manager/internal/config"
	"heat-save-manager/internal/discovery"
	"heat-save-manager/internal/fsops"
	"heat-save-manager/internal/health"
	"heat-save-manager/internal/lifecycle"
	"heat-save-manager/internal/marker"
	"heat-save-manager/internal/profiles"
	"heat-save-manager/internal/switcher"
	"heat-save-manager/internal/updater"
)

const (
	githubLatestURL     = "https://api.github.com/repos/ElrikCty/heat-save-manager/releases/latest"
	defaultUserAgent    = "heat-save-manager-update-check"
	defaultHTTPTimeout  = 8 * time.Second
	updateProgressEvent = "updater:progress"
	languageEnglish     = "en"
	languageSpanish     = "es"
)

var appVersion = "dev"

// App struct
type App struct {
	ctx          context.Context
	saveGamePath string
	profilesPath string
	language     string
	configStore  *config.Store
}

// NewApp creates a new App application struct
func NewApp() *App {
	store, err := config.NewStore()
	if err != nil {
		store = nil
	}

	return &App{
		language:    config.DefaultLanguage,
		configStore: store,
	}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.initDefaultPaths()
	a.applySavedSettings()
}

type ProfileItem struct {
	Name string `json:"name"`
}

type AppPaths struct {
	SaveGamePath string `json:"saveGamePath"`
	ProfilesPath string `json:"profilesPath"`
}

type UpdateInfo struct {
	CurrentVersion  string `json:"currentVersion"`
	LatestVersion   string `json:"latestVersion"`
	UpdateAvailable bool   `json:"updateAvailable"`
	ReleaseURL      string `json:"releaseUrl"`
	DownloadURL     string `json:"downloadUrl"`
	DownloadAsset   string `json:"downloadAsset"`
	DownloadKind    string `json:"downloadKind"`
	InAppEligible   bool   `json:"inAppEligible"`
	InAppReason     string `json:"inAppReason"`
	PublishedAt     string `json:"publishedAt"`
	Notes           string `json:"notes"`
}

type releaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

type UpdateInstallResult struct {
	Started     bool   `json:"started"`
	Message     string `json:"message"`
	FallbackURL string `json:"fallbackUrl"`
}

func (a *App) initDefaultPaths() {
	paths, err := discovery.LocateDefault()
	if err != nil {
		return
	}

	a.saveGamePath = paths.SaveGamePath
	a.profilesPath = paths.ProfilesPath
}

func (a *App) SetSaveGamePath(saveGamePath string) error {
	if err := a.applySaveGamePath(saveGamePath); err != nil {
		return err
	}

	return a.updateConfig(func(cfg *config.AppConfig) {
		cfg.SaveGamePath = a.saveGamePath
		cfg.ProfilesPath = a.profilesPath
	})
}

func (a *App) GetLanguage() string {
	return normalizeLanguage(a.language)
}

func (a *App) SetLanguage(language string) error {
	normalized, err := validateLanguage(language)
	if err != nil {
		return err
	}

	a.language = normalized

	return a.updateConfig(func(cfg *config.AppConfig) {
		cfg.Language = normalized
	})
}

func (a *App) GetAppVersion() string {
	return appVersion
}

func (a *App) CheckForUpdates() (UpdateInfo, error) {
	info := UpdateInfo{
		CurrentVersion: appVersion,
		LatestVersion:  appVersion,
	}

	client := &http.Client{Timeout: defaultHTTPTimeout}
	req, err := http.NewRequest(http.MethodGet, githubLatestURL, nil)
	if err != nil {
		return info, fmt.Errorf("create update check request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", defaultUserAgent)

	resp, err := client.Do(req)
	if err != nil {
		return info, fmt.Errorf("request latest release: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return info, fmt.Errorf("latest release check failed: %s (%s)", resp.Status, strings.TrimSpace(string(body)))
	}

	var payload struct {
		TagName     string         `json:"tag_name"`
		HTMLURL     string         `json:"html_url"`
		PublishedAt string         `json:"published_at"`
		Body        string         `json:"body"`
		Assets      []releaseAsset `json:"assets"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return info, fmt.Errorf("decode latest release payload: %w", err)
	}

	latest := strings.TrimSpace(payload.TagName)
	if latest == "" {
		return info, nil
	}

	info.LatestVersion = latest
	info.ReleaseURL = strings.TrimSpace(payload.HTMLURL)
	info.PublishedAt = strings.TrimSpace(payload.PublishedAt)
	info.Notes = strings.TrimSpace(payload.Body)

	selectedAsset := selectPreferredWindowsAsset(payload.Assets)
	info.DownloadURL = selectedAsset.URL
	info.DownloadAsset = selectedAsset.Name
	info.DownloadKind = selectedAsset.Kind
	info.InAppEligible = selectedAsset.Kind == "installer" && strings.TrimSpace(selectedAsset.URL) != ""
	info.InAppReason = selectedAsset.InAppReason

	if strings.EqualFold(strings.TrimSpace(info.CurrentVersion), "dev") {
		info.UpdateAvailable = false
		return info, nil
	}

	info.UpdateAvailable = isVersionNewer(info.CurrentVersion, info.LatestVersion)
	return info, nil
}

func (a *App) OpenExternalURL(rawURL string) error {
	if a.ctx == nil {
		return errors.New("app context is not ready")
	}

	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return errors.New("url is required")
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return errors.New("invalid url")
	}

	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return errors.New("url must be http or https")
	}

	runtime.BrowserOpenURL(a.ctx, trimmed)
	return nil
}

func (a *App) StartInAppUpdate(downloadURL string, releaseURL string) (UpdateInstallResult, error) {
	ctx := context.Background()
	if a.ctx != nil {
		ctx = a.ctx
	}

	svc := updater.NewService("", nil)
	svc.SetProgressCallback(func(progress updater.Progress) {
		if a.ctx == nil {
			return
		}

		payload := map[string]interface{}{
			"stage":   progress.Stage,
			"message": progress.Message,
		}

		if progress.DownloadedBytes > 0 {
			payload["downloadedBytes"] = progress.DownloadedBytes
		}

		if progress.TotalBytes > 0 {
			payload["totalBytes"] = progress.TotalBytes
		}

		if progress.Percent >= 0 {
			payload["percent"] = progress.Percent
		}

		runtime.EventsEmit(a.ctx, updateProgressEvent, payload)
	})

	result, err := svc.Start(ctx, downloadURL, releaseURL)
	if err != nil {
		return UpdateInstallResult{}, err
	}

	return UpdateInstallResult{
		Started:     result.Started,
		Message:     result.Message,
		FallbackURL: result.FallbackURL,
	}, nil
}

func (a *App) GetPaths() AppPaths {
	return AppPaths{
		SaveGamePath: a.saveGamePath,
		ProfilesPath: a.profilesPath,
	}
}

func (a *App) ListProfiles() ([]ProfileItem, error) {
	service := profiles.NewService(a.profilesPath)
	items, err := service.List()
	if err != nil {
		return nil, err
	}

	result := make([]ProfileItem, 0, len(items))
	for _, item := range items {
		result = append(result, ProfileItem{Name: item.Name})
	}

	return result, nil
}

func (a *App) GetActiveProfile() (string, error) {
	return a.newMarkerStore().ReadActiveProfile()
}

func (a *App) SwitchProfile(profileName string) (switcher.Result, error) {
	service := switcher.NewService(a.saveGamePath, a.profilesPath, a.newMarkerStore(), fsops.NewLocal())

	return service.Switch(switcher.Params{ProfileName: profileName})
}

func (a *App) PrepareFreshProfile(profileName string) error {
	return a.newLifecycleService().PrepareFreshProfile(profileName)
}

func (a *App) PrepareFreshProfileWithoutSave(profileName string) error {
	return a.newLifecycleService().PrepareFreshProfileWithoutSave(profileName)
}

func (a *App) SaveCurrentProfile(profileName string) error {
	return a.newLifecycleService().SaveCurrentProfile(profileName)
}

func (a *App) RenameProfile(oldName string, newName string) error {
	return a.newLifecycleService().RenameProfile(oldName, newName)
}

func (a *App) DeleteProfile(profileName string) error {
	return a.newLifecycleService().DeleteProfile(profileName)
}

func (a *App) DeleteActiveProfile(replacementProfileName string) error {
	return a.newLifecycleService().DeleteActiveProfile(replacementProfileName)
}

func (a *App) RunHealthCheck() health.Report {
	return health.NewService(a.saveGamePath, a.profilesPath).Run()
}

func (a *App) EnsureProfilesFolder() error {
	if strings.TrimSpace(a.saveGamePath) == "" {
		return errors.New("savegame path is not configured")
	}

	if strings.TrimSpace(a.profilesPath) == "" {
		a.profilesPath = filepath.Join(a.saveGamePath, "Profiles")
	}

	if err := os.MkdirAll(a.profilesPath, 0o755); err != nil {
		return fmt.Errorf("ensure Profiles folder: %w", err)
	}

	return nil
}

func (a *App) CreateMarkerFile(profileName string) error {
	if strings.TrimSpace(a.saveGamePath) == "" {
		return errors.New("savegame path is not configured")
	}

	if err := a.EnsureProfilesFolder(); err != nil {
		return err
	}

	trimmed, err := validateProfileNameInput(profileName)
	if err != nil {
		return err
	}

	cleanProfilesPath := filepath.Clean(a.profilesPath)
	profilePath := filepath.Join(cleanProfilesPath, trimmed)
	relPath, err := filepath.Rel(cleanProfilesPath, profilePath)
	if err != nil {
		return errors.New("profile name is invalid")
	}

	if relPath == ".." || strings.HasPrefix(relPath, ".."+string(os.PathSeparator)) {
		return errors.New("profile name is invalid")
	}

	info, err := os.Stat(profilePath)
	if err != nil {
		if os.IsNotExist(err) {
			return errors.New("profile not found")
		}
		return fmt.Errorf("inspect profile folder: %w", err)
	}

	if !info.IsDir() {
		return errors.New("profile not found")
	}

	store := a.newMarkerStore()
	if _, err := os.Stat(store.Path()); err == nil {
		return errors.New("active_profile.txt already exists")
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("inspect active_profile.txt: %w", err)
	}

	if err := store.WriteActiveProfile(trimmed); err != nil {
		return err
	}

	return nil
}

func validateProfileNameInput(profileName string) (string, error) {
	trimmed := strings.TrimSpace(profileName)
	if trimmed == "" {
		return "", marker.ErrProfileNameRequired
	}

	if strings.ContainsAny(trimmed, `<>:"/\|?*`) {
		return "", errors.New("profile name contains invalid characters")
	}

	if strings.HasSuffix(trimmed, ".") || strings.HasSuffix(trimmed, " ") {
		return "", errors.New("profile name contains invalid characters")
	}

	if trimmed == "." || trimmed == ".." {
		return "", errors.New("profile name contains invalid characters")
	}

	return trimmed, nil
}

func (a *App) ExportProfileBundle(profileName string, bundlePath string) error {
	return bundle.NewService(a.profilesPath).ExportProfile(profileName, bundlePath)
}

func (a *App) ImportProfileBundle(profileName string, bundlePath string) error {
	return bundle.NewService(a.profilesPath).ImportProfile(profileName, bundlePath)
}

func (a *App) PickExportBundlePath() (string, error) {
	if a.ctx == nil {
		return "", errors.New("app context is not ready")
	}

	return runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Export Profile Bundle",
		DefaultFilename: "profile-bundle.zip",
		Filters: []runtime.FileFilter{
			{DisplayName: "Zip Archive (*.zip)", Pattern: "*.zip"},
		},
	})
}

func (a *App) PickImportBundlePath() (string, error) {
	if a.ctx == nil {
		return "", errors.New("app context is not ready")
	}

	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Import Profile Bundle",
		Filters: []runtime.FileFilter{
			{DisplayName: "Zip Archive (*.zip)", Pattern: "*.zip"},
		},
	})
}

func (a *App) PickSaveGamePath() (string, error) {
	if a.ctx == nil {
		return "", errors.New("app context is not ready")
	}

	defaultDirectory := a.saveGamePath
	if strings.TrimSpace(defaultDirectory) == "" {
		if paths, err := discovery.LocateDefault(); err == nil {
			defaultDirectory = paths.SaveGamePath
		}
	}

	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:            "Select SaveGame Folder",
		DefaultDirectory: defaultDirectory,
	})
}

func (a *App) newLifecycleService() *lifecycle.Service {
	return lifecycle.NewService(a.saveGamePath, a.profilesPath, a.newMarkerStore(), fsops.NewLocal())
}

func (a *App) newMarkerStore() *marker.Store {
	return marker.NewStore(a.saveGamePath)
}

func (a *App) loadConfigOrDefault() config.AppConfig {
	cfg := config.Default()
	if a.configStore == nil {
		cfg.Language = normalizeLanguage(cfg.Language)
		return cfg
	}

	loaded, err := a.configStore.Load()
	if err == nil {
		cfg = loaded
	}

	cfg.Language = normalizeLanguage(cfg.Language)
	return cfg
}

func (a *App) updateConfig(update func(*config.AppConfig)) error {
	if a.configStore == nil {
		return nil
	}

	cfg := a.loadConfigOrDefault()
	if update != nil {
		update(&cfg)
	}

	if strings.TrimSpace(cfg.Language) == "" {
		cfg.Language = normalizeLanguage(a.language)
	}

	if err := a.configStore.Save(cfg); err != nil {
		return fmt.Errorf("save app settings: %w", err)
	}

	return nil
}

func (a *App) applySavedSettings() {
	cfg := a.loadConfigOrDefault()
	a.language = normalizeLanguage(cfg.Language)

	if strings.TrimSpace(cfg.SaveGamePath) == "" {
		return
	}

	_ = a.applySaveGamePath(cfg.SaveGamePath)
}

func normalizeLanguage(language string) string {
	switch strings.ToLower(strings.TrimSpace(language)) {
	case languageSpanish, "es-es", "es-419", "es-mx":
		return languageSpanish
	default:
		return languageEnglish
	}
}

func validateLanguage(language string) (string, error) {
	trimmed := strings.ToLower(strings.TrimSpace(language))
	switch trimmed {
	case languageEnglish, "en-us", "en-gb":
		return languageEnglish, nil
	case languageSpanish, "es-es", "es-419", "es-mx":
		return languageSpanish, nil
	case "":
		return "", errors.New("language is required")
	default:
		return "", errors.New("unsupported language")
	}
}

func (a *App) applySaveGamePath(saveGamePath string) error {
	trimmed := strings.TrimSpace(saveGamePath)
	if trimmed == "" {
		return errors.New("savegame path is required")
	}

	if !filepath.IsAbs(trimmed) {
		return errors.New("savegame path must be absolute")
	}

	info, err := os.Stat(trimmed)
	if err != nil {
		if os.IsNotExist(err) {
			return errors.New("savegame path does not exist")
		}
		return fmt.Errorf("read savegame path: %w", err)
	}

	if !info.IsDir() {
		return errors.New("savegame path must be a directory")
	}

	if !strings.EqualFold(filepath.Base(trimmed), "SaveGame") {
		return errors.New("path must point to the SaveGame folder")
	}

	parentDirName := filepath.Base(filepath.Dir(trimmed))
	if !strings.EqualFold(parentDirName, "Need for speed heat") {
		return errors.New("savegame path must be inside the Need for Speed Heat folder")
	}

	profilesPath := filepath.Join(trimmed, "Profiles")
	if err := os.MkdirAll(profilesPath, 0o755); err != nil {
		return fmt.Errorf("ensure Profiles folder: %w", err)
	}

	a.saveGamePath = trimmed
	a.profilesPath = profilesPath

	return nil
}

func isVersionNewer(current string, latest string) bool {
	cMajor, cMinor, cPatch, cOK := parseVersionParts(current)
	lMajor, lMinor, lPatch, lOK := parseVersionParts(latest)

	if !cOK || !lOK {
		return strings.TrimSpace(current) != strings.TrimSpace(latest)
	}

	if lMajor != cMajor {
		return lMajor > cMajor
	}

	if lMinor != cMinor {
		return lMinor > cMinor
	}

	return lPatch > cPatch
}

func parseVersionParts(tag string) (int, int, int, bool) {
	trimmed := strings.TrimSpace(strings.TrimPrefix(tag, "v"))
	if trimmed == "" {
		return 0, 0, 0, false
	}

	pieces := strings.Split(trimmed, ".")
	if len(pieces) < 3 {
		return 0, 0, 0, false
	}

	major, ok := parseVersionNumber(pieces[0])
	if !ok {
		return 0, 0, 0, false
	}

	minor, ok := parseVersionNumber(pieces[1])
	if !ok {
		return 0, 0, 0, false
	}

	patch, ok := parseVersionNumber(pieces[2])
	if !ok {
		return 0, 0, 0, false
	}

	return major, minor, patch, true
}

func parseVersionNumber(piece string) (int, bool) {
	trimmed := strings.TrimSpace(piece)
	if trimmed == "" {
		return 0, false
	}

	end := 0
	for end < len(trimmed) && trimmed[end] >= '0' && trimmed[end] <= '9' {
		end++
	}

	if end == 0 {
		return 0, false
	}

	value, err := strconv.Atoi(trimmed[:end])
	if err != nil {
		return 0, false
	}

	return value, true
}

type windowsAssetSelection struct {
	Name        string
	URL         string
	Kind        string
	InAppReason string
}

type windowsAssetCandidate struct {
	name      string
	url       string
	kind      string
	isX64     bool
	isWindows bool
}

func selectPreferredWindowsAsset(assets []releaseAsset) windowsAssetSelection {
	if len(assets) == 0 {
		return windowsAssetSelection{InAppReason: "In-app update is unavailable: no compatible Windows update asset was found in this release."}
	}

	candidates := make([]windowsAssetCandidate, 0, len(assets))
	for _, asset := range assets {
		name := strings.TrimSpace(asset.Name)
		if name == "" {
			continue
		}

		url := strings.TrimSpace(asset.BrowserDownloadURL)
		if url == "" {
			continue
		}

		lowerName := strings.ToLower(name)
		if strings.HasSuffix(lowerName, ".sha256") {
			continue
		}

		if strings.Contains(lowerName, "linux") || strings.Contains(lowerName, "darwin") || strings.Contains(lowerName, "macos") {
			continue
		}

		if strings.Contains(lowerName, "arm64") || strings.Contains(lowerName, "aarch64") {
			continue
		}

		kind := ""
		switch {
		case strings.HasSuffix(lowerName, ".exe") && strings.Contains(lowerName, "installer"):
			kind = "installer"
		case strings.HasSuffix(lowerName, ".exe"):
			kind = "exe"
		case strings.HasSuffix(lowerName, ".zip"):
			kind = "zip"
		default:
			continue
		}

		candidate := windowsAssetCandidate{
			name:      name,
			url:       url,
			kind:      kind,
			isX64:     strings.Contains(lowerName, "x64") || strings.Contains(lowerName, "amd64") || strings.Contains(lowerName, "x86_64"),
			isWindows: strings.Contains(lowerName, "windows") || strings.HasSuffix(lowerName, ".exe"),
		}

		candidates = append(candidates, candidate)
	}

	for _, preferredKind := range []string{"installer", "exe", "zip"} {
		if selected, ok := pickCandidate(candidates, preferredKind, true, true); ok {
			return selected
		}

		if selected, ok := pickCandidate(candidates, preferredKind, true, false); ok {
			return selected
		}

		if selected, ok := pickCandidate(candidates, preferredKind, false, true); ok {
			return selected
		}

		if selected, ok := pickCandidate(candidates, preferredKind, false, false); ok {
			return selected
		}
	}

	return windowsAssetSelection{InAppReason: "In-app update is unavailable: no compatible Windows update asset was found in this release."}
}

func pickCandidate(candidates []windowsAssetCandidate, kind string, requireX64 bool, requireWindows bool) (windowsAssetSelection, bool) {
	for _, candidate := range candidates {
		if candidate.kind != kind {
			continue
		}

		if requireX64 && !candidate.isX64 {
			continue
		}

		if requireWindows && !candidate.isWindows {
			continue
		}

		selection := windowsAssetSelection{
			Name: candidate.name,
			URL:  candidate.url,
			Kind: candidate.kind,
		}

		if candidate.kind != "installer" {
			selection.InAppReason = "In-app update is unavailable: this release does not include a Windows installer asset."
		}

		return selection, true
	}

	return windowsAssetSelection{}, false
}
