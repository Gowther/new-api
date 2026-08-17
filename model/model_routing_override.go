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
	Scope     string `json:"-" gorm:"type:varchar(16)"`
}

const modelRoutingOverrideScopeChannel = "channel"

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

func refreshModelRoutingOverrideCache() error {
	if !common.MemoryCacheEnabled || DB == nil || !DB.Migrator().HasTable(&ModelRoutingOverride{}) {
		return nil
	}
	return InitModelRoutingOverrideCache()
}

func cachedModelRoutingOverrideTarget(modelName string) (int, bool) {
	modelRoutingOverrideCacheLock.RLock()
	defer modelRoutingOverrideCacheLock.RUnlock()

	for _, candidate := range modelRoutingAbilityCandidates(modelName) {
		overrides := modelRoutingOverrideCache[candidate]
		selectedGroup := ""
		selectedChannelID := 0
		for group, channelID := range overrides {
			if selectedGroup == "" || group < selectedGroup {
				selectedGroup = group
				selectedChannelID = channelID
			}
		}
		if selectedGroup != "" {
			return selectedChannelID, true
		}
	}
	return 0, false
}

// GetModelRoutingOverrideTarget resolves the model-wide temporary routing target.
// Exact model rules take precedence over normalized wildcard rules. The presence
// of any matching row activates fail-closed routing for the whole model.
func GetModelRoutingOverrideTarget(modelName string) (int, bool, error) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return 0, false, nil
	}

	if common.MemoryCacheEnabled {
		channelID, found := cachedModelRoutingOverrideTarget(modelName)
		return channelID, found, nil
	}

	for _, candidate := range modelRoutingAbilityCandidates(modelName) {
		var overrides []ModelRoutingOverride
		if err := DB.Where("model = ?", candidate).Find(&overrides).Error; err != nil {
			return 0, false, err
		}
		if len(overrides) == 0 {
			continue
		}
		sortModelRoutingOverrides(overrides)
		return overrides[0].ChannelId, true, nil
	}
	return 0, false, nil
}

func GetModelRoutingOverrides(modelName string) ([]ModelRoutingOverride, error) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return []ModelRoutingOverride{}, nil
	}
	for _, candidate := range modelRoutingAbilityCandidates(modelName) {
		var overrides []ModelRoutingOverride
		if err := DB.Where("model = ?", candidate).Find(&overrides).Error; err != nil {
			return nil, err
		}
		if len(overrides) == 0 {
			continue
		}
		sortModelRoutingOverrides(overrides)
		return overrides, nil
	}
	return []ModelRoutingOverride{}, nil
}

func GetAllModelRoutingOverrides() ([]ModelRoutingOverride, error) {
	var overrides []ModelRoutingOverride
	if err := DB.Find(&overrides).Error; err != nil {
		return nil, err
	}
	sortModelRoutingOverrides(overrides)
	return overrides, nil
}

func sortModelRoutingOverrides(overrides []ModelRoutingOverride) {
	sort.Slice(overrides, func(i, j int) bool {
		if overrides[i].Model != overrides[j].Model {
			return overrides[i].Model < overrides[j].Model
		}
		return overrides[i].Group < overrides[j].Group
	})
}

func buildChannelModelRoutingOverrides(channelID int, enabledOnly bool) ([]ModelRoutingOverride, error) {
	query := DB.Where("channel_id = ?", channelID)
	if enabledOnly {
		query = query.Where("enabled = ?", true)
	}

	var abilities []Ability
	if err := query.Find(&abilities).Error; err != nil {
		return nil, err
	}
	if len(abilities) == 0 {
		if enabledOnly {
			return nil, fmt.Errorf("channel %d does not have any enabled model ability", channelID)
		}
		return nil, fmt.Errorf("channel %d does not have any model ability", channelID)
	}

	abilitySet := make(map[string]struct{}, len(abilities))
	overrides := make([]ModelRoutingOverride, 0, len(abilities))
	for _, ability := range abilities {
		modelName := strings.TrimSpace(ability.Model)
		group := strings.TrimSpace(ability.Group)
		if modelName == "" || len(modelName) > 255 || group == "" {
			continue
		}
		key := modelName + "\x00" + group
		if _, exists := abilitySet[key]; exists {
			continue
		}
		abilitySet[key] = struct{}{}
		overrides = append(overrides, ModelRoutingOverride{
			Model:     modelName,
			Group:     group,
			ChannelId: channelID,
			Scope:     modelRoutingOverrideScopeChannel,
		})
	}
	if len(overrides) == 0 {
		return nil, fmt.Errorf("channel %d does not have any valid model ability", channelID)
	}
	sortModelRoutingOverrides(overrides)
	return overrides, nil
}

func replaceAllModelRoutingOverrides(tx *gorm.DB, overrides []ModelRoutingOverride) error {
	if err := tx.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&ModelRoutingOverride{}).Error; err != nil {
		return err
	}
	if len(overrides) == 0 {
		return nil
	}
	return tx.Create(&overrides).Error
}

// migrateLegacyModelRoutingOverrides upgrades the old model-scoped rows once.
// A single unambiguous target is expanded to the channel's current abilities;
// ambiguous multi-channel data is cleared instead of silently choosing a target.
func migrateLegacyModelRoutingOverrides() error {
	if DB == nil || !DB.Migrator().HasTable(&ModelRoutingOverride{}) ||
		!DB.Migrator().HasColumn(&ModelRoutingOverride{}, "scope") {
		return nil
	}

	legacyQuery := DB.Model(&ModelRoutingOverride{}).Where("scope = ? OR scope IS NULL", "")
	var legacyCount int64
	if err := legacyQuery.Count(&legacyCount).Error; err != nil {
		return err
	}
	if legacyCount == 0 {
		return nil
	}

	var existing []ModelRoutingOverride
	if err := DB.Find(&existing).Error; err != nil {
		return err
	}
	targetChannelIDs := make(map[int]struct{})
	for _, override := range existing {
		targetChannelIDs[override.ChannelId] = struct{}{}
	}
	if len(targetChannelIDs) != 1 {
		if err := DB.Transaction(func(tx *gorm.DB) error {
			return replaceAllModelRoutingOverrides(tx, nil)
		}); err != nil {
			return err
		}
		common.SysLog(fmt.Sprintf(
			"cleared %d legacy model routing overrides with ambiguous channel targets",
			len(existing),
		))
		return nil
	}

	targetChannelID := 0
	for channelID := range targetChannelIDs {
		targetChannelID = channelID
	}
	channel, err := GetChannelById(targetChannelID, false)
	if errors.Is(err, gorm.ErrRecordNotFound) ||
		(err == nil && channel.Status == common.ChannelStatusManuallyDisabled) {
		if err := DB.Transaction(func(tx *gorm.DB) error {
			return replaceAllModelRoutingOverrides(tx, nil)
		}); err != nil {
			return err
		}
		common.SysLog(fmt.Sprintf(
			"cleared %d legacy model routing overrides for unavailable channel %d",
			len(existing), targetChannelID,
		))
		return nil
	}
	if err != nil {
		return err
	}

	enabledOnly := channel.Status != common.ChannelStatusAutoDisabled
	normalized, err := buildChannelModelRoutingOverrides(targetChannelID, enabledOnly)
	if err != nil {
		if err := legacyQuery.Update("scope", modelRoutingOverrideScopeChannel).Error; err != nil {
			return err
		}
		common.SysLog(fmt.Sprintf(
			"preserved %d legacy model routing overrides for channel %d without expansion: %v",
			len(existing), targetChannelID, err,
		))
		return nil
	}
	if err := DB.Transaction(func(tx *gorm.DB) error {
		return replaceAllModelRoutingOverrides(tx, normalized)
	}); err != nil {
		return err
	}
	common.SysLog(fmt.Sprintf(
		"migrated %d legacy model routing overrides to %d channel-wide rules for channel %d",
		len(existing), len(normalized), targetChannelID,
	))
	return nil
}

// SetChannelModelRoutingOverride atomically replaces every temporary routing
// rule with the enabled model/group abilities of channelID.
func SetChannelModelRoutingOverride(channelID int) ([]ModelRoutingOverride, error) {
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

	overrides, err := buildChannelModelRoutingOverrides(channelID, true)
	if err != nil {
		return nil, err
	}

	err = DB.Transaction(func(tx *gorm.DB) error {
		return replaceAllModelRoutingOverrides(tx, overrides)
	})
	if err != nil {
		return nil, err
	}
	if err := refreshModelRoutingOverrideCache(); err != nil {
		return nil, err
	}
	return overrides, nil
}

// SetModelRoutingOverride is retained for source compatibility with older
// callers. Temporary routing is now channel-scoped.
func SetModelRoutingOverride(modelName string, channelID int) ([]ModelRoutingOverride, error) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" || len(modelName) > 255 {
		return nil, errors.New("invalid model name")
	}
	return SetChannelModelRoutingOverride(channelID)
}

func DeleteModelRoutingOverride(modelName string) (int64, error) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return 0, errors.New("invalid model name")
	}
	result := DB.Where("model IN ?", modelRoutingAbilityCandidates(modelName)).Delete(&ModelRoutingOverride{})
	if result.Error != nil {
		return 0, result.Error
	}
	if err := refreshModelRoutingOverrideCache(); err != nil {
		return 0, err
	}
	return result.RowsAffected, nil
}

func DeleteAllModelRoutingOverrides() (int64, error) {
	result := DB.Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&ModelRoutingOverride{})
	if result.Error != nil {
		return 0, result.Error
	}
	if err := refreshModelRoutingOverrideCache(); err != nil {
		return 0, err
	}
	return result.RowsAffected, nil
}

func deleteModelRoutingOverridesByChannelIDs(tx *gorm.DB, channelIDs []int) (int64, error) {
	if tx == nil || len(channelIDs) == 0 {
		return 0, nil
	}
	if !tx.Migrator().HasTable(&ModelRoutingOverride{}) {
		return 0, nil
	}
	result := tx.Where("channel_id IN ?", channelIDs).Delete(&ModelRoutingOverride{})
	return result.RowsAffected, result.Error
}

func DeleteModelRoutingOverridesByChannelIDs(channelIDs []int) (int64, error) {
	deleted, err := deleteModelRoutingOverridesByChannelIDs(DB, channelIDs)
	if err != nil {
		return 0, err
	}
	if err := refreshModelRoutingOverrideCache(); err != nil {
		return 0, err
	}
	return deleted, nil
}
