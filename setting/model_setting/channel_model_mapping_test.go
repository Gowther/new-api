package model_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeChannelModelMappingRules(t *testing.T) {
	rules, err := NormalizeChannelModelMappingRules([]types.ChannelModelMappingRule{
		{
			MatchMode:     " CONTAINS ",
			MatchValue:    " GLM-5.2 ",
			CaseSensitive: false,
			ExposedModel:  " GLM-5.2 ",
			Priority:      100,
			Enabled:       true,
		},
	})
	require.NoError(t, err)
	require.Len(t, rules, 1)
	assert.Equal(t, types.ChannelModelMatchModeContains, rules[0].MatchMode)
	assert.Equal(t, "GLM-5.2", rules[0].ExposedModel)
	assert.Equal(t, "GLM-5.2", rules[0].MatchValue)
}

func TestNormalizeChannelModelMappingRulesRejectsDuplicateRule(t *testing.T) {
	rule := types.ChannelModelMappingRule{
		MatchMode:     types.ChannelModelMatchModeContains,
		MatchValue:    "glm-5.2",
		CaseSensitive: false,
		ExposedModel:  "GLM-5.2",
		Enabled:       true,
	}
	_, err := NormalizeChannelModelMappingRules([]types.ChannelModelMappingRule{rule, rule})
	require.Error(t, err)
}
