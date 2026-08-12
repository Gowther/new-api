package model

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"gorm.io/gorm"
)

type ModelRoutingOverride struct {
	Model     string `json:"model" gorm:"type:varchar(255);primaryKey;autoIncrement:false"`
	Group     string `json:"group" gorm:"type:varchar(64);primaryKey;autoIncrement:false"`
	ChannelId int    `json:"channel_id" gorm:"index"`
}

var modelRoutingOverrideCache = map[string]map[string]int{}
var modelRoutingOverrideCacheLock sync.RWMutex

func modelRoutingAbilityCandidates(modelName string) []string {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return nil
	}
	candidates := []string{modelName}
	normalized := ratio_setting.FormatMatchingModelName(modelName)
	if normalized != "" && normalized != modelName {
		candidates = append(candidates, normalized)
	}
	return candidates
}

func InitModelRoutingOverrideCache() error {
	var overrides []ModelRoutingOverride
	if err := DB.Find(&overrides).Error; err != nil {
		return err
	}

	next := make(map[string]map[string]int)
	for _, override := range overrides {
		if next[override.Model] == nil {
			next[override.Model] = make(map[string]int)
		}
		next[override.Model][override.Group] = override.ChannelId
	}

	modelRoutingOverrideCacheLock.Lock()
	modelRoutingOverrideCache = next
	modelRoutingOverrideCacheLock.Unlock()
	return nil
}

func SyncModelRoutingOverrideCache(frequency int) {
	for {
		time.Sleep(time.Duration(frequency) * time.Second)
		if err := InitModelRoutingOverrideCache(); err != nil {
			common.SysError("failed to sync model routing overrides: " + err.Error())
		}
	}
}

// GetModelRoutingOverrideTarget resolves the model-wide temporary routing target.
// The group rows describe where the target was eligible when the mode was enabled,
// but the presence of any row activates fail-closed routing for the whole model.
func GetModelRoutingOverrideTarget(modelName string) (int, bool, error) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return 0, false, nil
	}

	if common.MemoryCacheEnabled {
		modelRoutingOverrideCacheLock.RLock()
		defer modelRoutingOverrideCacheLock.RUnlock()
		overrides := modelRoutingOverrideCache[modelName]
		selectedGroup := ""
		selectedChannelID := 0
		for group, channelID := range overrides {
			if selectedGroup == "" || group < selectedGroup {
				selectedGroup = group
				selectedChannelID = channelID
			}
		}
		if selectedGroup != "" {
			return selectedChannelID, true, nil
		}
		return 0, false, nil
	}

	var override ModelRoutingOverride
	result := DB.Where("model = ?", modelName).Limit(1).Find(&override)
	if result.Error != nil {
		return 0, false, result.Error
	}
	if result.RowsAffected > 0 {
		return override.ChannelId, true, nil
	}
	return 0, false, nil
}

func GetModelRoutingOverrides(modelName string) ([]ModelRoutingOverride, error) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return []ModelRoutingOverride{}, nil
	}
	var overrides []ModelRoutingOverride
	if err := DB.Where("model = ?", modelName).Find(&overrides).Error; err != nil {
		return nil, err
	}
	sort.Slice(overrides, func(i, j int) bool {
		return overrides[i].Group < overrides[j].Group
	})
	return overrides, nil
}

func SetModelRoutingOverride(modelName string, channelID int) ([]ModelRoutingOverride, error) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" || len(modelName) > 255 {
		return nil, errors.New("invalid model name")
	}
	if channelID <= 0 {
		return nil, errors.New("invalid channel id")
	}

	channel, err := GetChannelById(channelID, false)
	if err != nil {
		return nil, err
	}
	if channel.Status != common.ChannelStatusEnabled {
		return nil, errors.New("the target channel is disabled")
	}

	candidates := modelRoutingAbilityCandidates(modelName)
	var abilities []Ability
	if err := DB.Where("channel_id = ? AND model IN ? AND enabled = ?", channelID, candidates, true).Find(&abilities).Error; err != nil {
		return nil, err
	}
	if len(abilities) == 0 {
		return nil, fmt.Errorf("channel %d does not support model %s in any enabled group", channelID, modelName)
	}

	groupSet := make(map[string]struct{}, len(abilities))
	for _, ability := range abilities {
		group := strings.TrimSpace(ability.Group)
		if group != "" {
			groupSet[group] = struct{}{}
		}
	}
	groups := make([]string, 0, len(groupSet))
	for group := range groupSet {
		groups = append(groups, group)
	}
	sort.Strings(groups)
	if len(groups) == 0 {
		return nil, fmt.Errorf("channel %d does not support model %s in any enabled group", channelID, modelName)
	}

	overrides := make([]ModelRoutingOverride, 0, len(groups))
	for _, group := range groups {
		overrides = append(overrides, ModelRoutingOverride{
			Model:     modelName,
			Group:     group,
			ChannelId: channelID,
		})
	}

	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("model = ?", modelName).Delete(&ModelRoutingOverride{}).Error; err != nil {
			return err
		}
		return tx.Create(&overrides).Error
	})
	if err != nil {
		return nil, err
	}
	if common.MemoryCacheEnabled {
		if err := InitModelRoutingOverrideCache(); err != nil {
			return nil, err
		}
	}
	return overrides, nil
}

func DeleteModelRoutingOverride(modelName string) (int64, error) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return 0, errors.New("invalid model name")
	}
	result := DB.Where("model = ?", modelName).Delete(&ModelRoutingOverride{})
	if result.Error != nil {
		return 0, result.Error
	}
	if common.MemoryCacheEnabled {
		if err := InitModelRoutingOverrideCache(); err != nil {
			return 0, err
		}
	}
	return result.RowsAffected, nil
}
