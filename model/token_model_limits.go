package model

import (
	"sort"
	"strings"
)

type StaleTokenModelLimit struct {
	TokenId     int      `json:"token_id"`
	TokenName   string   `json:"token_name"`
	StaleModels []string `json:"stale_models"`
}

type StaleTokenModelLimitsReport struct {
	StaleModels []string               `json:"stale_models"`
	Tokens      []StaleTokenModelLimit `json:"tokens"`
}

// GetUserStaleTokenModelLimits reports entries in a user's token model limits
// that no enabled channel serves. Stale entries are harmless (requests fail
// with no available channel either way) and become useful again once a channel
// serves the model, so callers must not remove them automatically.
func GetUserStaleTokenModelLimits(userId int) (*StaleTokenModelLimitsReport, error) {
	enabledModels := GetEnabledModels()
	enabled := make(map[string]struct{}, len(enabledModels))
	for _, modelName := range enabledModels {
		enabled[modelName] = struct{}{}
	}

	var tokens []*Token
	if err := DB.Where("user_id = ? AND model_limits_enabled = ? AND model_limits <> ?", userId, true, "").Find(&tokens).Error; err != nil {
		return nil, err
	}

	report := &StaleTokenModelLimitsReport{
		StaleModels: []string{},
		Tokens:      []StaleTokenModelLimit{},
	}
	staleModelSet := make(map[string]struct{})
	for _, token := range tokens {
		staleModels := make([]string, 0)
		for _, modelName := range token.GetModelLimits() {
			if strings.TrimSpace(modelName) == "" {
				continue
			}
			if _, ok := enabled[modelName]; ok {
				continue
			}
			staleModels = append(staleModels, modelName)
			staleModelSet[modelName] = struct{}{}
		}
		if len(staleModels) == 0 {
			continue
		}
		report.Tokens = append(report.Tokens, StaleTokenModelLimit{
			TokenId:     token.Id,
			TokenName:   token.Name,
			StaleModels: staleModels,
		})
	}
	for modelName := range staleModelSet {
		report.StaleModels = append(report.StaleModels, modelName)
	}
	sort.Strings(report.StaleModels)
	return report, nil
}

// CleanupStaleTokenModelLimits strips stale entries from the given tokens of a
// user. Staleness is recomputed at cleanup time, so only currently unserved
// models are removed; a token whose limits become empty falls back to no model
// restriction.
func CleanupStaleTokenModelLimits(userId int, tokenIds []int) (int, error) {
	if len(tokenIds) == 0 {
		return 0, nil
	}

	report, err := GetUserStaleTokenModelLimits(userId)
	if err != nil {
		return 0, err
	}
	staleByToken := make(map[int]map[string]struct{}, len(report.Tokens))
	for _, item := range report.Tokens {
		staleSet := make(map[string]struct{}, len(item.StaleModels))
		for _, modelName := range item.StaleModels {
			staleSet[modelName] = struct{}{}
		}
		staleByToken[item.TokenId] = staleSet
	}

	changed := 0
	for _, tokenId := range tokenIds {
		staleSet, ok := staleByToken[tokenId]
		if !ok {
			continue
		}
		token, err := GetTokenByIds(tokenId, userId)
		if err != nil {
			continue
		}
		keptModels := make([]string, 0)
		for _, modelName := range token.GetModelLimits() {
			if strings.TrimSpace(modelName) == "" {
				continue
			}
			if _, isStale := staleSet[modelName]; isStale {
				continue
			}
			keptModels = append(keptModels, modelName)
		}
		if len(keptModels) == 0 {
			token.ModelLimitsEnabled = false
			token.ModelLimits = ""
		} else {
			token.ModelLimits = strings.Join(keptModels, ",")
		}
		if err := token.Update(); err != nil {
			return changed, err
		}
		changed++
	}
	return changed, nil
}
