package model_setting

import (
	"fmt"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/types"
)

const (
	ChannelQuickMappingRulesOptionKey = "channel_quick_mapping_setting.rules"
	maxChannelQuickMappingRules       = 1000
	maxChannelQuickMappingTextLength  = 255
)

var (
	channelQuickMappingRulesMutex sync.RWMutex
	channelQuickMappingRules      = []types.ChannelQuickMappingRule{
		{
			MatchMode:     types.ChannelModelMatchModeContains,
			MatchValue:    "gpt-",
			CaseSensitive: false,
			AliasModel:    "codex-auto-review",
			Enabled:       true,
		},
		{
			MatchMode:     types.ChannelModelMatchModeContains,
			MatchValue:    "grok-",
			CaseSensitive: false,
			AliasModel:    "grok-4.20-fast",
			Enabled:       true,
		},
	}
)

func NormalizeChannelQuickMappingRules(rules []types.ChannelQuickMappingRule) ([]types.ChannelQuickMappingRule, error) {
	if len(rules) > maxChannelQuickMappingRules {
		return nil, fmt.Errorf("channel quick mapping rules cannot exceed %d entries", maxChannelQuickMappingRules)
	}

	normalized := make([]types.ChannelQuickMappingRule, 0, len(rules))
	aliases := make(map[string]struct{}, len(rules))
	for index, rule := range rules {
		rule.MatchMode = strings.ToLower(strings.TrimSpace(rule.MatchMode))
		rule.MatchValue = strings.TrimSpace(rule.MatchValue)
		rule.AliasModel = strings.TrimSpace(rule.AliasModel)

		if rule.MatchMode != types.ChannelModelMatchModeExact && rule.MatchMode != types.ChannelModelMatchModeContains {
			return nil, fmt.Errorf("rule %d has unsupported match mode %q", index+1, rule.MatchMode)
		}
		if rule.MatchValue == "" {
			return nil, fmt.Errorf("rule %d match value cannot be empty", index+1)
		}
		if rule.AliasModel == "" {
			return nil, fmt.Errorf("rule %d alias model cannot be empty", index+1)
		}
		if len(rule.MatchValue) > maxChannelQuickMappingTextLength || len(rule.AliasModel) > maxChannelQuickMappingTextLength {
			return nil, fmt.Errorf("rule %d model name exceeds %d characters", index+1, maxChannelQuickMappingTextLength)
		}

		aliasKey := strings.ToLower(rule.AliasModel)
		if _, exists := aliases[aliasKey]; exists {
			return nil, fmt.Errorf("rule %d duplicates an alias model", index+1)
		}
		aliases[aliasKey] = struct{}{}
		normalized = append(normalized, rule)
	}
	return normalized, nil
}

func CheckChannelQuickMappingRules(jsonStr string) error {
	var rules []types.ChannelQuickMappingRule
	if err := common.UnmarshalJsonStr(jsonStr, &rules); err != nil {
		return fmt.Errorf("invalid channel quick mapping rules: %w", err)
	}
	_, err := NormalizeChannelQuickMappingRules(rules)
	return err
}

func UpdateChannelQuickMappingRulesByJSONString(jsonStr string) error {
	var rules []types.ChannelQuickMappingRule
	if err := common.UnmarshalJsonStr(jsonStr, &rules); err != nil {
		return fmt.Errorf("invalid channel quick mapping rules: %w", err)
	}
	normalized, err := NormalizeChannelQuickMappingRules(rules)
	if err != nil {
		return err
	}

	channelQuickMappingRulesMutex.Lock()
	channelQuickMappingRules = normalized
	channelQuickMappingRulesMutex.Unlock()
	return nil
}

func ChannelQuickMappingRules2JSONString() string {
	rules := GetChannelQuickMappingRules()
	jsonBytes, err := common.Marshal(rules)
	if err != nil {
		common.SysError("failed to marshal channel quick mapping rules: " + err.Error())
		return "[]"
	}
	return string(jsonBytes)
}

func GetChannelQuickMappingRules() []types.ChannelQuickMappingRule {
	channelQuickMappingRulesMutex.RLock()
	defer channelQuickMappingRulesMutex.RUnlock()
	return append([]types.ChannelQuickMappingRule(nil), channelQuickMappingRules...)
}
