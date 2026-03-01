package config

const MarkerFileName = "active_profile.txt"
const DefaultLanguage = "en"

type AppConfig struct {
	SaveGamePath       string `json:"saveGamePath"`
	ProfilesPath       string `json:"profilesPath"`
	Language           string `json:"language"`
	BackupBeforeSwitch bool   `json:"backupBeforeSwitch"`
	CheckGameRunning   bool   `json:"checkGameRunning"`
}

func Default() AppConfig {
	return AppConfig{
		Language:           DefaultLanguage,
		BackupBeforeSwitch: true,
		CheckGameRunning:   true,
	}
}
