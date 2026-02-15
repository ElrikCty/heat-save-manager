package config

const MarkerFileName = "active_profile.txt"

type AppConfig struct {
	SaveGamePath       string `json:"saveGamePath"`
	ProfilesPath       string `json:"profilesPath"`
	BackupBeforeSwitch bool   `json:"backupBeforeSwitch"`
	CheckGameRunning   bool   `json:"checkGameRunning"`
}

func Default() AppConfig {
	return AppConfig{
		BackupBeforeSwitch: true,
		CheckGameRunning:   true,
	}
}
