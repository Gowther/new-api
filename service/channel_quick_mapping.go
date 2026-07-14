package service

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/QuantumNous/new-api/types"
)

func PreviewChannelQuickMappings(req dto.ChannelQuickMappingPreviewRequest) (*dto.ChannelQuickMappingPreview, error) {
	return previewChannelQuickMappings(req, model_setting.GetChannelQuickMappingRules())
}

func previewChannelQuickMappings(req dto.ChannelQuickMappingPreviewRequest, rules []types.ChannelQuickMappingRule) (*dto.ChannelQuickMappingPreview, error) {

	models := make([]string, 0, len(req.Models))
	modelNames := make(map[string]struct{}, len(req.Models))
	for _, modelName := range req.Models {
		modelName = strings.TrimSpace(modelName)
		if modelName == "" {
			continue
		}
		modelKey := strings.ToLower(modelName)
		if _, exists := modelNames[modelKey]; exists {
			continue
		}
		modelNames[modelKey] = struct{}{}
		models = append(models, modelName)
	}

	mappingAliases := make(map[string]struct{})
	if rawMapping := strings.TrimSpace(req.ModelMapping); rawMapping != "" && rawMapping != "{}" {
		var mapping map[string]string
		if err := common.UnmarshalJsonStr(rawMapping, &mapping); err != nil {
			return nil, fmt.Errorf("invalid model mapping: %w", err)
		}
		for alias := range mapping {
			alias = strings.TrimSpace(alias)
			if alias != "" {
				mappingAliases[strings.ToLower(alias)] = struct{}{}
			}
		}
	}

	suggestions := make([]dto.ChannelQuickMappingSuggestion, 0, len(rules))
	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}
		aliasKey := strings.ToLower(rule.AliasModel)
		if _, exists := modelNames[aliasKey]; exists {
			continue
		}
		if _, exists := mappingAliases[aliasKey]; exists {
			continue
		}

		triggered := false
		for _, modelName := range models {
			if channelQuickMappingRuleMatches(rule, modelName) {
				triggered = true
				break
			}
		}
		if !triggered {
			continue
		}

		suggestions = append(suggestions, dto.ChannelQuickMappingSuggestion{
			AliasModel:      rule.AliasModel,
			MatchMode:       rule.MatchMode,
			MatchValue:      rule.MatchValue,
			CandidateModels: append([]string(nil), models...),
		})
	}

	return &dto.ChannelQuickMappingPreview{Suggestions: suggestions}, nil
}

func channelQuickMappingRuleMatches(rule types.ChannelQuickMappingRule, modelName string) bool {
	matchValue := rule.MatchValue
	candidate := modelName
	if !rule.CaseSensitive {
		matchValue = strings.ToLower(matchValue)
		candidate = strings.ToLower(candidate)
	}
	if rule.MatchMode == types.ChannelModelMatchModeExact {
		return candidate == matchValue
	}
	return strings.Contains(candidate, matchValue)
}
