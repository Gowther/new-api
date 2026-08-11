package operation_setting

import (
	"errors"
	"math/rand"
	"os"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"
)

type MonitorSetting struct {
	AutoTestChannelEnabled bool     `json:"auto_test_channel_enabled"`
	AutoTestChannelMinutes float64  `json:"auto_test_channel_minutes"`
	ChannelTestMode        string   `json:"channel_test_mode"`
	ChannelTestPrompts     []string `json:"channel_test_prompts"`
	ChannelTestPromptMode  string   `json:"channel_test_prompt_mode"`
	ChannelTestPrompt      string   `json:"channel_test_prompt"`
}

const (
	ChannelTestModeScheduledAll    = "scheduled_all"
	ChannelTestModePassiveRecovery = "passive_recovery"
	ChannelTestPromptModeFixed     = "fixed"
	ChannelTestPromptModeRandom    = "random"
	DefaultChannelTestPrompt       = "Explain in one short sentence why caching can reduce latency."
)

// 默认配置
var monitorSetting = MonitorSetting{
	AutoTestChannelEnabled: false,
	AutoTestChannelMinutes: 10,
	ChannelTestMode:        ChannelTestModeScheduledAll,
	ChannelTestPrompts:     []string{DefaultChannelTestPrompt},
	ChannelTestPromptMode:  ChannelTestPromptModeFixed,
	ChannelTestPrompt:      DefaultChannelTestPrompt,
}

func init() {
	// 注册到全局配置管理器
	config.GlobalConfig.Register("monitor_setting", &monitorSetting)
}

func GetMonitorSetting() *MonitorSetting {
	if os.Getenv("CHANNEL_TEST_FREQUENCY") != "" {
		frequency, err := strconv.Atoi(os.Getenv("CHANNEL_TEST_FREQUENCY"))
		if err == nil && frequency > 0 {
			monitorSetting.AutoTestChannelEnabled = true
			monitorSetting.AutoTestChannelMinutes = float64(frequency)
			monitorSetting.ChannelTestMode = ChannelTestModeScheduledAll
		}
	}
	if enabled, ok := os.LookupEnv("CHANNEL_TEST_ENABLED"); ok {
		parsed, err := strconv.ParseBool(enabled)
		if err == nil {
			monitorSetting.AutoTestChannelEnabled = parsed
		}
	}
	if monitorSetting.ChannelTestMode != ChannelTestModePassiveRecovery {
		monitorSetting.ChannelTestMode = ChannelTestModeScheduledAll
	}
	monitorSetting.ChannelTestPrompts = normalizeChannelTestPrompts(monitorSetting.ChannelTestPrompts)
	if monitorSetting.ChannelTestPromptMode != ChannelTestPromptModeRandom {
		monitorSetting.ChannelTestPromptMode = ChannelTestPromptModeFixed
	}
	if !containsChannelTestPrompt(monitorSetting.ChannelTestPrompts, monitorSetting.ChannelTestPrompt) {
		monitorSetting.ChannelTestPrompt = monitorSetting.ChannelTestPrompts[0]
	}
	return &monitorSetting
}

func GetChannelTestPrompt() string {
	return getChannelTestPrompt(rand.Intn)
}

func getChannelTestPrompt(randomIndex func(int) int) string {
	setting := GetMonitorSetting()
	if setting.ChannelTestPromptMode == ChannelTestPromptModeRandom {
		return setting.ChannelTestPrompts[randomIndex(len(setting.ChannelTestPrompts))]
	}
	return setting.ChannelTestPrompt
}

func NormalizeChannelTestPromptsJSON(value string) (string, error) {
	var prompts []string
	if err := common.UnmarshalJsonStr(value, &prompts); err != nil {
		return "", errors.New("channel test prompts must be a JSON string array")
	}
	hasPrompt := false
	for _, prompt := range prompts {
		if strings.TrimSpace(prompt) != "" {
			hasPrompt = true
			break
		}
	}
	if !hasPrompt {
		return "", errors.New("at least one channel test prompt is required")
	}
	prompts = normalizeChannelTestPrompts(prompts)
	data, err := common.Marshal(prompts)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func IsValidChannelTestPromptMode(mode string) bool {
	return mode == ChannelTestPromptModeFixed || mode == ChannelTestPromptModeRandom
}

func normalizeChannelTestPrompts(prompts []string) []string {
	normalized := make([]string, 0, len(prompts))
	seen := make(map[string]struct{}, len(prompts))
	for _, prompt := range prompts {
		prompt = strings.TrimSpace(prompt)
		if prompt == "" {
			continue
		}
		if _, ok := seen[prompt]; ok {
			continue
		}
		seen[prompt] = struct{}{}
		normalized = append(normalized, prompt)
	}
	if len(normalized) == 0 {
		return []string{DefaultChannelTestPrompt}
	}
	return normalized
}

func containsChannelTestPrompt(prompts []string, selected string) bool {
	for _, prompt := range prompts {
		if prompt == selected {
			return true
		}
	}
	return false
}
