package service

import (
	"fmt"
	"maps"
	"slices"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/QuantumNous/new-api/types"
)

type channelModelMappingCandidate struct {
	model string
	rule  types.ChannelModelMappingRule
}

func PreviewChannelModelMappings(req dto.ChannelModelMappingPreviewRequest) (*dto.ChannelModelMappingPreview, error) {
	rules := model_setting.GetChannelModelMappingRules()
	if req.Rules != nil {
		var err error
		rules, err = model_setting.NormalizeChannelModelMappingRules(*req.Rules)
		if err != nil {
			return nil, err
		}
	}
	sort.SliceStable(rules, func(i, j int) bool {
		if rules[i].Priority != rules[j].Priority {
			return rules[i].Priority > rules[j].Priority
		}
		if rules[i].MatchMode != rules[j].MatchMode {
			return rules[i].MatchMode == types.ChannelModelMatchModeExact
		}
		return len(rules[i].MatchValue) > len(rules[j].MatchValue)
	})

	models := make([]string, 0, len(req.Models))
	modelSet := make(map[string]struct{}, len(req.Models))
	for _, modelName := range req.Models {
		modelName = strings.TrimSpace(modelName)
		if modelName == "" {
			continue
		}
		if _, exists := modelSet[modelName]; exists {
			continue
		}
		modelSet[modelName] = struct{}{}
		models = append(models, modelName)
	}

	mapping := make(map[string]string)
	if rawMapping := strings.TrimSpace(req.ModelMapping); rawMapping != "" && rawMapping != "{}" {
		var parsed map[string]string
		if err := common.UnmarshalJsonStr(rawMapping, &parsed); err != nil {
			return nil, fmt.Errorf("invalid model mapping: %w", err)
		}
		for source, target := range parsed {
			source = strings.TrimSpace(source)
			target = strings.TrimSpace(target)
			if source == "" || target == "" {
				return nil, fmt.Errorf("model mapping source and target cannot be empty")
			}
			mapping[source] = target
		}
	}
	originalMapping := maps.Clone(mapping)

	exposedModels := make(map[string]struct{}, len(rules))
	for _, rule := range rules {
		if rule.Enabled {
			exposedModels[rule.ExposedModel] = struct{}{}
		}
	}

	groups := make(map[string][]channelModelMappingCandidate)
	groupOrder := make([]string, 0)
	changeByModel := make(map[string]dto.ChannelModelMappingPreviewChange)
	for _, modelName := range models {
		if _, alreadyExposed := exposedModels[modelName]; alreadyExposed {
			continue
		}
		for _, rule := range rules {
			if !rule.Enabled || !channelModelMappingRuleMatches(rule, modelName) {
				continue
			}
			if _, exists := groups[rule.ExposedModel]; !exists {
				groupOrder = append(groupOrder, rule.ExposedModel)
			}
			groups[rule.ExposedModel] = append(groups[rule.ExposedModel], channelModelMappingCandidate{
				model: modelName,
				rule:  rule,
			})
			changeByModel[modelName] = dto.ChannelModelMappingPreviewChange{
				UpstreamModel: modelName,
				ExposedModel:  rule.ExposedModel,
				MatchMode:     rule.MatchMode,
				MatchValue:    rule.MatchValue,
			}
			break
		}
	}

	replacements := make(map[string]string)
	removedModels := make([]string, 0)
	addedModels := make([]string, 0)
	hasConflicts := false
	for _, exposedModel := range groupOrder {
		candidates := groups[exposedModel]
		targets := make([]string, 0, len(candidates))
		targetSet := make(map[string]struct{}, len(candidates))
		for _, candidate := range candidates {
			if _, exists := targetSet[candidate.model]; exists {
				continue
			}
			targetSet[candidate.model] = struct{}{}
			targets = append(targets, candidate.model)
		}

		existingTarget, hasExistingTarget := mapping[exposedModel]
		chosenTarget := ""
		if hasExistingTarget {
			if _, matchesCandidate := targetSet[existingTarget]; matchesCandidate {
				chosenTarget = existingTarget
			} else {
				hasConflicts = true
				for _, candidate := range candidates {
					change := changeByModel[candidate.model]
					change.Status = dto.ChannelModelMappingChangeConflict
					change.ConflictType = dto.ChannelModelMappingConflictExistingMapping
					change.ExistingTarget = existingTarget
					change.CandidateTargets = append([]string(nil), targets...)
					changeByModel[candidate.model] = change
				}
				continue
			}
		} else if len(targets) == 1 {
			chosenTarget = targets[0]
		} else {
			hasConflicts = true
			for _, candidate := range candidates {
				change := changeByModel[candidate.model]
				change.Status = dto.ChannelModelMappingChangeConflict
				change.ConflictType = dto.ChannelModelMappingConflictMultipleTargets
				change.CandidateTargets = append([]string(nil), targets...)
				changeByModel[candidate.model] = change
			}
			continue
		}

		mapping[exposedModel] = chosenTarget
		replacements[chosenTarget] = exposedModel
		removedModels = append(removedModels, chosenTarget)
		if _, exists := modelSet[exposedModel]; !exists {
			addedModels = append(addedModels, exposedModel)
		}
		for _, candidate := range candidates {
			change := changeByModel[candidate.model]
			if candidate.model == chosenTarget {
				change.Status = dto.ChannelModelMappingChangeApplied
			} else {
				hasConflicts = true
				change.Status = dto.ChannelModelMappingChangeConflict
				change.ConflictType = dto.ChannelModelMappingConflictMultipleTargets
				change.CandidateTargets = append([]string(nil), targets...)
			}
			changeByModel[candidate.model] = change
		}
	}

	resultModels := make([]string, 0, len(models)+len(addedModels))
	resultSet := make(map[string]struct{}, len(models)+len(addedModels))
	for _, modelName := range models {
		if exposedModel, replaced := replacements[modelName]; replaced {
			if _, exists := resultSet[exposedModel]; !exists {
				resultSet[exposedModel] = struct{}{}
				resultModels = append(resultModels, exposedModel)
			}
			continue
		}
		if _, exists := resultSet[modelName]; exists {
			continue
		}
		resultSet[modelName] = struct{}{}
		resultModels = append(resultModels, modelName)
	}

	changes := make([]dto.ChannelModelMappingPreviewChange, 0, len(changeByModel))
	for _, modelName := range models {
		if change, exists := changeByModel[modelName]; exists {
			changes = append(changes, change)
		}
	}

	return &dto.ChannelModelMappingPreview{
		Models:        resultModels,
		ModelMapping:  mapping,
		RemovedModels: removedModels,
		AddedModels:   addedModels,
		Changes:       changes,
		HasChanges:    !slices.Equal(models, resultModels) || !maps.Equal(originalMapping, mapping),
		HasConflicts:  hasConflicts,
	}, nil
}

func channelModelMappingRuleMatches(rule types.ChannelModelMappingRule, modelName string) bool {
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
