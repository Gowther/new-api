package reasoning

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseDeepSeekThinkingSuffix(t *testing.T) {
	tests := []struct {
		name         string
		model        string
		wantBase     string
		wantThinking string
		wantEffort   string
		wantOK       bool
	}{
		{name: "no suffix", model: "deepseek-flash", wantBase: "deepseek-flash", wantOK: false},
		{name: "none disables thinking", model: "deepseek-flash-none", wantBase: "deepseek-flash", wantThinking: "disabled", wantOK: true},
		{name: "low effort", model: "deepseek-flash-low", wantBase: "deepseek-flash", wantThinking: "enabled", wantEffort: "low", wantOK: true},
		{name: "high effort", model: "deepseek-flash-high", wantBase: "deepseek-flash", wantThinking: "enabled", wantEffort: "high", wantOK: true},
		{name: "max effort", model: "deepseek-flash-max", wantBase: "deepseek-flash", wantThinking: "enabled", wantEffort: "max", wantOK: true},
		{
			name: "official alias minimal", model: "deepseek-flash-minimal",
			wantBase: "deepseek-flash", wantThinking: "enabled", wantEffort: "minimal", wantOK: true,
		},
		{
			name: "official alias medium", model: "deepseek-flash-medium",
			wantBase: "deepseek-flash", wantThinking: "enabled", wantEffort: "medium", wantOK: true,
		},
		{
			name: "official alias xhigh", model: "deepseek-flash-xhigh",
			wantBase: "deepseek-flash", wantThinking: "enabled", wantEffort: "xhigh", wantOK: true,
		},
		{
			name: "official alias ultra", model: "deepseek-flash-ultra",
			wantBase: "deepseek-flash", wantThinking: "enabled", wantEffort: "ultra", wantOK: true,
		},
		{
			name: "v4 flash legacy name", model: "deepseek-v4-flash-max",
			wantBase: "deepseek-v4-flash", wantThinking: "enabled", wantEffort: "max", wantOK: true,
		},
		{
			name: "v4 pro legacy name", model: "deepseek-v4-pro-none",
			wantBase: "deepseek-v4-pro", wantThinking: "disabled", wantOK: true,
		},
		{
			name: "v4.1 naming", model: "deepseek-v4.1-flash-high",
			wantBase: "deepseek-v4.1-flash", wantThinking: "enabled", wantEffort: "high", wantOK: true,
		},
		{name: "legacy chat excluded", model: "deepseek-chat-max", wantBase: "deepseek-chat-max", wantOK: false},
		{name: "legacy reasoner excluded", model: "deepseek-reasoner-none", wantBase: "deepseek-reasoner-none", wantOK: false},
		{name: "unrelated model untouched", model: "gpt-5-max", wantBase: "gpt-5-max", wantOK: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			baseModel, thinkingType, effort, ok := ParseDeepSeekThinkingSuffix(tt.model)
			require.Equal(t, tt.wantOK, ok, "model: %s", tt.model)
			assert.Equal(t, tt.wantBase, baseModel, "model: %s", tt.model)
			assert.Equal(t, tt.wantThinking, thinkingType, "model: %s", tt.model)
			assert.Equal(t, tt.wantEffort, effort, "model: %s", tt.model)
		})
	}
}
