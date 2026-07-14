package service

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPreviewChannelModelMappingsUsesOriginalUpstreamModelAsTarget(t *testing.T) {
	rules := []types.ChannelModelMappingRule{
		{
			MatchMode:     types.ChannelModelMatchModeContains,
			MatchValue:    "glm-5.2",
			CaseSensitive: false,
			ExposedModel:  "GLM-5.2",
			Priority:      100,
			Enabled:       true,
		},
	}
	preview, err := PreviewChannelModelMappings(dto.ChannelModelMappingPreviewRequest{
		Models: []string{"gpt-4o", "ZAI.AI/GLM-5.2"},
		Rules:  &rules,
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"gpt-4o", "GLM-5.2"}, preview.Models)
	assert.Equal(t, "ZAI.AI/GLM-5.2", preview.ModelMapping["GLM-5.2"])
	assert.Equal(t, []string{"ZAI.AI/GLM-5.2"}, preview.RemovedModels)
	assert.Equal(t, []string{"GLM-5.2"}, preview.AddedModels)
	assert.True(t, preview.HasChanges)
	assert.False(t, preview.HasConflicts)
}

func TestPreviewChannelModelMappingsPreservesExistingMappingConflict(t *testing.T) {
	rules := []types.ChannelModelMappingRule{
		{
			MatchMode:     types.ChannelModelMatchModeContains,
			MatchValue:    "glm-5.2",
			CaseSensitive: false,
			ExposedModel:  "GLM-5.2",
			Enabled:       true,
		},
	}
	preview, err := PreviewChannelModelMappings(dto.ChannelModelMappingPreviewRequest{
		Models:       []string{"zai.ai/glm-5.2"},
		ModelMapping: `{"GLM-5.2":"another-upstream"}`,
		Rules:        &rules,
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"zai.ai/glm-5.2"}, preview.Models)
	assert.Equal(t, "another-upstream", preview.ModelMapping["GLM-5.2"])
	assert.False(t, preview.HasChanges)
	assert.True(t, preview.HasConflicts)
	require.Len(t, preview.Changes, 1)
	assert.Equal(t, dto.ChannelModelMappingConflictExistingMapping, preview.Changes[0].ConflictType)
}

func TestPreviewChannelModelMappingsReportsMultipleTargets(t *testing.T) {
	rules := []types.ChannelModelMappingRule{
		{
			MatchMode:     types.ChannelModelMatchModeContains,
			MatchValue:    "glm-5.2",
			CaseSensitive: false,
			ExposedModel:  "GLM-5.2",
			Enabled:       true,
		},
	}
	preview, err := PreviewChannelModelMappings(dto.ChannelModelMappingPreviewRequest{
		Models: []string{"glm-5.2", "zai.ai/glm-5.2"},
		Rules:  &rules,
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"glm-5.2", "zai.ai/glm-5.2"}, preview.Models)
	assert.Empty(t, preview.ModelMapping)
	assert.False(t, preview.HasChanges)
	assert.True(t, preview.HasConflicts)
	require.Len(t, preview.Changes, 2)
	assert.Equal(t, dto.ChannelModelMappingConflictMultipleTargets, preview.Changes[0].ConflictType)
	assert.Equal(t, dto.ChannelModelMappingConflictMultipleTargets, preview.Changes[1].ConflictType)
}

func TestPreviewChannelModelMappingsDoesNotRemapExposedModel(t *testing.T) {
	rules := []types.ChannelModelMappingRule{
		{
			MatchMode:     types.ChannelModelMatchModeContains,
			MatchValue:    "glm-5.2",
			CaseSensitive: false,
			ExposedModel:  "GLM-5.2",
			Enabled:       true,
		},
	}
	preview, err := PreviewChannelModelMappings(dto.ChannelModelMappingPreviewRequest{
		Models: []string{"GLM-5.2"},
		Rules:  &rules,
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"GLM-5.2"}, preview.Models)
	assert.Empty(t, preview.ModelMapping)
	assert.False(t, preview.HasChanges)
	assert.Empty(t, preview.Changes)
}
