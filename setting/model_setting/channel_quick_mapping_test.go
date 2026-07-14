package model_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeChannelQuickMappingRules(t *testing.T) {
	rules, err := NormalizeChannelQuickMappingRules([]types.ChannelQuickMappingRule{
		{
			MatchMode:     " CONTAINS ",
			MatchValue:    " gpt- ",
			CaseSensitive: false,
			AliasModel:    " codex-auto-review ",
			Enabled:       true,
		},
	})
	require.NoError(t, err)
	require.Len(t, rules, 1)
	assert.Equal(t, types.ChannelModelMatchModeContains, rules[0].MatchMode)
	assert.Equal(t, "gpt-", rules[0].MatchValue)
	assert.Equal(t, "codex-auto-review", rules[0].AliasModel)
}

func TestNormalizeChannelQuickMappingRulesRejectsDuplicateAlias(t *testing.T) {
	_, err := NormalizeChannelQuickMappingRules([]types.ChannelQuickMappingRule{
		{MatchMode: types.ChannelModelMatchModeContains, MatchValue: "gpt-", AliasModel: "codex-auto-review", Enabled: true},
		{MatchMode: types.ChannelModelMatchModeContains, MatchValue: "o1-", AliasModel: "CODEX-AUTO-REVIEW", Enabled: true},
	})
	require.Error(t, err)
}
