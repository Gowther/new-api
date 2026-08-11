package operation_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetMonitorSetting_ChannelTestEnabledEnvOverridesEnabledConfig(t *testing.T) {
	orig := monitorSetting
	t.Cleanup(func() { monitorSetting = orig })

	t.Setenv("CHANNEL_TEST_ENABLED", "false")
	t.Setenv("CHANNEL_TEST_FREQUENCY", "5")
	monitorSetting = MonitorSetting{
		AutoTestChannelEnabled: true,
		AutoTestChannelMinutes: 20,
	}

	setting := GetMonitorSetting()

	require.NotNil(t, setting)
	assert.False(t, setting.AutoTestChannelEnabled)
	assert.Equal(t, float64(5), setting.AutoTestChannelMinutes)
}

func TestGetMonitorSetting_ChannelTestEnabledEnvCanEnableDisabledConfig(t *testing.T) {
	orig := monitorSetting
	t.Cleanup(func() { monitorSetting = orig })

	t.Setenv("CHANNEL_TEST_ENABLED", "true")
	monitorSetting = MonitorSetting{
		AutoTestChannelEnabled: false,
		AutoTestChannelMinutes: 12,
	}

	setting := GetMonitorSetting()

	require.NotNil(t, setting)
	assert.True(t, setting.AutoTestChannelEnabled)
	assert.Equal(t, float64(12), setting.AutoTestChannelMinutes)
}

func TestGetChannelTestPromptUsesFixedSelection(t *testing.T) {
	orig := monitorSetting
	t.Cleanup(func() { monitorSetting = orig })

	monitorSetting = MonitorSetting{
		ChannelTestPrompts:    []string{"first prompt", "selected prompt"},
		ChannelTestPromptMode: ChannelTestPromptModeFixed,
		ChannelTestPrompt:     "selected prompt",
	}

	assert.Equal(t, "selected prompt", GetChannelTestPrompt())
}

func TestGetChannelTestPromptRandomModeUsesConfiguredPrompts(t *testing.T) {
	orig := monitorSetting
	t.Cleanup(func() { monitorSetting = orig })

	monitorSetting = MonitorSetting{
		ChannelTestPrompts:    []string{"first prompt", "second prompt"},
		ChannelTestPromptMode: ChannelTestPromptModeRandom,
	}

	prompt := getChannelTestPrompt(func(length int) int {
		assert.Equal(t, 2, length)
		return 1
	})

	assert.Equal(t, "second prompt", prompt)
}

func TestGetMonitorSettingNormalizesChannelTestPromptConfiguration(t *testing.T) {
	orig := monitorSetting
	t.Cleanup(func() { monitorSetting = orig })

	monitorSetting = MonitorSetting{
		ChannelTestPrompts:    []string{" first prompt ", "", "first prompt", "second prompt"},
		ChannelTestPromptMode: "unsupported",
		ChannelTestPrompt:     "missing prompt",
	}

	setting := GetMonitorSetting()

	require.NotNil(t, setting)
	assert.Equal(t, []string{"first prompt", "second prompt"}, setting.ChannelTestPrompts)
	assert.Equal(t, ChannelTestPromptModeFixed, setting.ChannelTestPromptMode)
	assert.Equal(t, "first prompt", setting.ChannelTestPrompt)
}

func TestNormalizeChannelTestPromptsJSON(t *testing.T) {
	normalized, err := NormalizeChannelTestPromptsJSON(`[" first prompt ","first prompt","second prompt"]`)

	require.NoError(t, err)
	assert.JSONEq(t, `["first prompt","second prompt"]`, normalized)

	_, err = NormalizeChannelTestPromptsJSON(`[]`)
	require.EqualError(t, err, "at least one channel test prompt is required")

	_, err = NormalizeChannelTestPromptsJSON(`[" "]`)
	require.EqualError(t, err, "at least one channel test prompt is required")

	_, err = NormalizeChannelTestPromptsJSON(`{"prompt":"test"}`)
	require.EqualError(t, err, "channel test prompts must be a JSON string array")
}
