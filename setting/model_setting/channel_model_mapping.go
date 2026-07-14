package model_setting

import (
	"fmt"
	"strconv"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/types"
)

const (
	ChannelModelMappingRulesOptionKey = "channel_model_mapping_setting.rules"
	maxChannelModelMappingRules       = 1000
	maxChannelModelRuleTextLength     = 255
	maxChannelModelRulePriority       = 10000
)

var (
	channelModelMappingRulesMutex sync.RWMutex
	channelModelMappingRules      = []types.ChannelModelMappingRule{
		{
			MatchMode:     types.ChannelModelMatchModeContains,
			MatchValue:    "glm-5.2",
			CaseSensitive: false,
			ExposedModel:  "GLM-5.2",
			Priority:      100,
			Enabled:       true,
		},
	}
)

func NormalizeChannelModelMappingRules(rules []types.ChannelModelMappingRule) ([]types.ChannelModelMappingRule, error) {
	if len(rules) > maxChannelModelMappingRules {
		return nil, fmt.Errorf("channel model mapping rules cannot exceed %d entries", maxChannelModelMappingRules)
	}

	normalized := make([]types.ChannelModelMappingRule, 0, len(rules))
	seen := make(map[string]struct{}, len(rules))
	for index, rule := range rules {
		rule.MatchMode = strings.ToLower(strings.TrimSpace(rule.MatchMode))
		rule.MatchValue = strings.TrimSpace(rule.MatchValue)
		rule.ExposedModel = strings.TrimSpace(rule.ExposedModel)

		if rule.MatchMode != types.ChannelModelMatchModeExact && rule.MatchMode != types.ChannelModelMatchModeContains {
			return nil, fmt.Errorf("rule %d has unsupported match mode %q", index+1, rule.MatchMode)
		}
		if rule.MatchValue == "" {
			return nil, fmt.Errorf("rule %d match value cannot be empty", index+1)
		}
		if rule.ExposedModel == "" {
			return nil, fmt.Errorf("rule %d exposed model cannot be empty", index+1)
		}
		if len(rule.MatchValue) > maxChannelModelRuleTextLength || len(rule.ExposedModel) > maxChannelModelRuleTextLength {
			return nil, fmt.Errorf("rule %d model name exceeds %d characters", index+1, maxChannelModelRuleTextLength)
		}
		if rule.Priority < -maxChannelModelRulePriority || rule.Priority > maxChannelModelRulePriority {
			return nil, fmt.Errorf("rule %d priority must be between -%d and %d", index+1, maxChannelModelRulePriority, maxChannelModelRulePriority)
		}

		matchKey := rule.MatchValue
		if !rule.CaseSensitive {
			matchKey = strings.ToLower(matchKey)
		}
		signature := rule.MatchMode + "\x00" + strconv.FormatBool(rule.CaseSensitive) + "\x00" + matchKey + "\x00" + rule.ExposedModel
		if _, exists := seen[signature]; exists {
			return nil, fmt.Errorf("rule %d duplicates an existing mapping rule", index+1)
		}
		seen[signature] = struct{}{}
		normalized = append(normalized, rule)
	}
	return normalized, nil
}

func CheckChannelModelMappingRules(jsonStr string) error {
	var rules []types.ChannelModelMappingRule
	if err := common.UnmarshalJsonStr(jsonStr, &rules); err != nil {
		return fmt.Errorf("invalid channel model mapping rules: %w", err)
	}
	_, err := NormalizeChannelModelMappingRules(rules)
	return err
}

func UpdateChannelModelMappingRulesByJSONString(jsonStr string) error {
	var rules []types.ChannelModelMappingRule
	if err := common.UnmarshalJsonStr(jsonStr, &rules); err != nil {
		return fmt.Errorf("invalid channel model mapping rules: %w", err)
	}
	normalized, err := NormalizeChannelModelMappingRules(rules)
	if err != nil {
		return err
	}

	channelModelMappingRulesMutex.Lock()
	channelModelMappingRules = normalized
	channelModelMappingRulesMutex.Unlock()
	return nil
}

func ChannelModelMappingRules2JSONString() string {
	rules := GetChannelModelMappingRules()
	jsonBytes, err := common.Marshal(rules)
	if err != nil {
		common.SysError("failed to marshal channel model mapping rules: " + err.Error())
		return "[]"
	}
	return string(jsonBytes)
}

func GetChannelModelMappingRules() []types.ChannelModelMappingRule {
	channelModelMappingRulesMutex.RLock()
	defer channelModelMappingRulesMutex.RUnlock()
	return append([]types.ChannelModelMappingRule(nil), channelModelMappingRules...)
}
