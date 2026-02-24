package health

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"heat-save-manager/internal/config"
)

type Item struct {
	Name     string `json:"name"`
	Ok       bool   `json:"ok"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

type Report struct {
	Ready     bool      `json:"ready"`
	CheckedAt time.Time `json:"checkedAt"`
	Items     []Item    `json:"items"`
}

type Service struct {
	saveGamePath string
	profilesPath string
	now          func() time.Time
}

func NewService(saveGamePath string, profilesPath string) *Service {
	return &Service{
		saveGamePath: saveGamePath,
		profilesPath: profilesPath,
		now:          time.Now,
	}
}

func (s *Service) Run() Report {
	report := Report{
		Ready:     true,
		CheckedAt: s.now().UTC(),
		Items:     make([]Item, 0, 6),
	}

	add := func(item Item) {
		report.Items = append(report.Items, item)
		if item.Severity == "error" {
			report.Ready = false
		}
	}

	if strings.TrimSpace(s.saveGamePath) == "" {
		add(Item{Name: "savegame_path", Ok: false, Severity: "error", Message: "SaveGame path is not configured."})
		return report
	}

	add(checkDirectory("savegame_path", s.saveGamePath, true))
	add(checkDirectory("profiles_path", s.profilesPath, false))
	add(checkDirectory("root_savegame_folder", filepath.Join(s.saveGamePath, "savegame"), false))
	add(checkDirectory("root_wraps_folder", filepath.Join(s.saveGamePath, "wraps"), false))

	markerPath := filepath.Join(s.saveGamePath, config.MarkerFileName)
	markerContent, markerItem := checkMarker(markerPath)
	add(markerItem)

	if markerContent != "" {
		activePath := filepath.Join(s.profilesPath, markerContent)
		if info, err := os.Stat(activePath); err == nil && info.IsDir() {
			add(Item{Name: "active_profile_folder", Ok: true, Severity: "ok", Message: "Active profile folder exists."})
		} else {
			add(Item{Name: "active_profile_folder", Ok: false, Severity: "warn", Message: "Active profile marker does not match a folder in Profiles."})
		}
	}

	return report
}

func checkDirectory(name string, path string, required bool) Item {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			severity := "warn"
			if required {
				severity = "error"
			}
			return Item{Name: name, Ok: false, Severity: severity, Message: "Directory is missing."}
		}

		severity := "warn"
		if required {
			severity = "error"
		}
		return Item{Name: name, Ok: false, Severity: severity, Message: "Failed to inspect directory."}
	}

	if !info.IsDir() {
		severity := "warn"
		if required {
			severity = "error"
		}
		return Item{Name: name, Ok: false, Severity: severity, Message: "Path exists but is not a directory."}
	}

	return Item{Name: name, Ok: true, Severity: "ok", Message: "Directory is available."}
}

func checkMarker(path string) (string, Item) {
	content, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", Item{Name: "marker_file", Ok: false, Severity: "warn", Message: "active_profile.txt is missing."}
		}

		return "", Item{Name: "marker_file", Ok: false, Severity: "warn", Message: "Failed to read active_profile.txt."}
	}

	trimmed := strings.TrimSpace(string(content))
	if trimmed == "" {
		return "", Item{Name: "marker_file", Ok: false, Severity: "warn", Message: "active_profile.txt is empty."}
	}

	return trimmed, Item{Name: "marker_file", Ok: true, Severity: "ok", Message: "active_profile.txt is valid."}
}
