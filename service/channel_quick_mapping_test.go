package service

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPreviewChannelQuickMappingsUsesAllSelectedModelsAsCandidates(t *testing.T) {
	rules := []types.ChannelQuickMappingRule{
		{
			MatchMode:     types.ChannelModelMatchModeContains,
			MatchValue:    "gpt-",
			CaseSensitive: false,
			AliasModel:    "codex-auto-review",
			Enabled:       true,
		},
	}
	preview, err := previewChannelQuickMappings(dto.ChannelQuickMappingPreviewRequest{
		Models: []string{"gpt-4.1", "custom-review-model"},
	}, rules)
	require.NoError(t, err)
	require.Len(t, preview.Suggestions, 1)
	assert.Equal(t, "codex-auto-review", preview.Suggestions[0].AliasModel)
	assert.Equal(t, []string{"gpt-4.1", "custom-review-model"}, preview.Suggestions[0].CandidateModels)
}

func TestPreviewChannelQuickMappingsSkipsNativeAndExistingAliases(t *testing.T) {
	rules := []types.ChannelQuickMappingRule{
		{
			MatchMode:  types.ChannelModelMatchModeContains,
			MatchValue: "gpt-",
			AliasModel: "codex-auto-review",
			Enabled:    true,
		},
	}
	preview, err := previewChannelQuickMappings(dto.ChannelQuickMappingPreviewRequest{
		Models: []string{"gpt-4.1", "codex-auto-review"},
	}, rules)
	require.NoError(t, err)
	assert.Empty(t, preview.Suggestions)

	preview, err = previewChannelQuickMappings(dto.ChannelQuickMappingPreviewRequest{
		Models:       []string{"gpt-4.1"},
		ModelMapping: `{"codex-auto-review":"gpt-4.1"}`,
	}, rules)
	require.NoError(t, err)
	assert.Empty(t, preview.Suggestions)
}

func TestPreviewChannelQuickMappingsSupportsExactAndCaseInsensitiveContains(t *testing.T) {
	rules := []types.ChannelQuickMappingRule{
		{MatchMode: types.ChannelModelMatchModeExact, MatchValue: "reviewer", AliasModel: "review-alias", Enabled: true},
		{MatchMode: types.ChannelModelMatchModeContains, MatchValue: "grok-", AliasModel: "grok-4.20-fast", Enabled: true},
	}
	preview, err := previewChannelQuickMappings(dto.ChannelQuickMappingPreviewRequest{
		Models: []string{"REVIEWER", "GROK-4.1"},
	}, rules)
	require.NoError(t, err)
	require.Len(t, preview.Suggestions, 2)
	assert.Equal(t, "review-alias", preview.Suggestions[0].AliasModel)
	assert.Equal(t, "grok-4.20-fast", preview.Suggestions[1].AliasModel)
}
