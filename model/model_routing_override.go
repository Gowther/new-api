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

// ModelRoutingOverrideConflict names a channel whose temporary rules overlap a
// candidate channel, along with the models they collide on.
type ModelRoutingOverrideConflict struct {
	ChannelId   int      `json:"channel_id"`
	ChannelName string   `json:"channel_name"`
	Models      []string `json:"models"`
}

// ModelRoutingOverrideResult reports what a set attempt did. Applied is false
// only when conflicts blocked the write, in which case nothing was persisted and
// Conflicts names the channels the caller has to release first.
type ModelRoutingOverrideResult struct {
	Applied   bool
	Overrides []ModelRoutingOverride
	Conflicts []ModelRoutingOverrideConflict
}

const modelRoutingOverrideScopeChannel = "channel"

var modelRoutingOverrideCache = map[string]map[string]int{}
var modelRoutingOverrideCacheLock sync.RWMutex
var modelRoutingOverrideMutationLock sync.Mutex

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

func modelRoutingConflictKey(modelName string) string {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return ""
	}
	normalized := ratio_setting.FormatMatchingModelName(modelName)
	if normalized != "" {
		return normalized
	}
	return modelName
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

// findModelRoutingOverrideConflicts groups the temporary rules overlapping the
// candidate's model set by the channel that currently owns them, so callers can
// name the channels that a replacement would release. The reported model names
// are the ones the existing channels pin, which is what a wildcard rule shows.
func findModelRoutingOverrideConflicts(
	tx *gorm.DB,
	channelID int,
	overrides []ModelRoutingOverride,
) ([]ModelRoutingOverrideConflict, error) {
	var existing []ModelRoutingOverride
	if err := tx.Where("channel_id <> ?", channelID).Find(&existing).Error; err != nil {
		return nil, err
	}
	if len(existing) == 0 {
		return nil, nil
	}

	candidateKeys := make(map[string]struct{}, len(overrides))
	for _, override := range overrides {
		if key := modelRoutingConflictKey(override.Model); key != "" {
			candidateKeys[key] = struct{}{}
		}
	}

	modelsByChannel := make(map[int]map[string]struct{})
	for _, override := range existing {
		key := modelRoutingConflictKey(override.Model)
		if key == "" {
			continue
		}
		if _, overlaps := candidateKeys[key]; !overlaps {
			continue
		}
		if modelsByChannel[override.ChannelId] == nil {
			modelsByChannel[override.ChannelId] = make(map[string]struct{})
		}
		modelsByChannel[override.ChannelId][override.Model] = struct{}{}
	}
	if len(modelsByChannel) == 0 {
		return nil, nil
	}

	conflictChannelIDs := make([]int, 0, len(modelsByChannel))
	for conflictChannelID := range modelsByChannel {
		conflictChannelIDs = append(conflictChannelIDs, conflictChannelID)
	}
	sort.Ints(conflictChannelIDs)

	// Names come from tx in one query: the caller may hold a transaction, and
	// reaching for another connection there can deadlock a small pool.
	var conflictChannels []Channel
	if err := tx.Select("id", "name").
		Where("id IN ?", conflictChannelIDs).
		Find(&conflictChannels).Error; err != nil {
		return nil, err
	}
	namesByChannel := make(map[int]string, len(conflictChannels))
	for _, channel := range conflictChannels {
		namesByChannel[channel.Id] = channel.Name
	}

	conflicts := make([]ModelRoutingOverrideConflict, 0, len(conflictChannelIDs))
	for _, conflictChannelID := range conflictChannelIDs {
		models := make([]string, 0, len(modelsByChannel[conflictChannelID]))
		for modelName := range modelsByChannel[conflictChannelID] {
			models = append(models, modelName)
		}
		sort.Strings(models)
		conflicts = append(conflicts, ModelRoutingOverrideConflict{
			ChannelId:   conflictChannelID,
			ChannelName: namesByChannel[conflictChannelID],
			Models:      models,
		})
	}
	return conflicts, nil
}

// ModelRoutingOverrideConflictError renders conflicts as the single-line message
// used by callers that can only carry an error.
func ModelRoutingOverrideConflictError(conflicts []ModelRoutingOverrideConflict) error {
	details := make([]string, 0, len(conflicts))
	for _, conflict := range conflicts {
		details = append(details, fmt.Sprintf(
			"%s (channel %d)",
			strings.Join(conflict.Models, ", "),
			conflict.ChannelId,
		))
	}
	return fmt.Errorf(
		"temporary routing conflicts with existing channel rules: %s",
		strings.Join(details, "; "),
	)
}

func deleteLegacyModelRoutingOverrides(tx *gorm.DB) error {
	return tx.Where("scope = ? OR scope IS NULL", "").Delete(&ModelRoutingOverride{}).Error
}

// migrateLegacyModelRoutingOverrides upgrades the old model-scoped rows once.
// A single unambiguous target is expanded to the channel's current abilities;
// ambiguous multi-channel data is cleared instead of silently choosing a target.
// Existing channel-scoped rules are preserved during this migration.
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

	var legacy []ModelRoutingOverride
	if err := legacyQuery.Find(&legacy).Error; err != nil {
		return err
	}
	targetChannelIDs := make(map[int]struct{})
	for _, override := range legacy {
		targetChannelIDs[override.ChannelId] = struct{}{}
	}
	if len(targetChannelIDs) != 1 {
		if err := DB.Transaction(func(tx *gorm.DB) error {
			return deleteLegacyModelRoutingOverrides(tx)
		}); err != nil {
			return err
		}
		common.SysLog(fmt.Sprintf(
			"cleared %d legacy model routing overrides with ambiguous channel targets",
			len(legacy),
		))
		return nil
	}

	targetChannelID := 0
	for channelID := range targetChannelIDs {
		targetChannelID = channelID
	}
	channel, err := GetChannelById(targetChannelID, false)
	if errors.Is(err, gorm.ErrRecordNotFound) ||
		(err == nil && channelStatusStopsServing(channel.Status)) {
		if err := DB.Transaction(func(tx *gorm.DB) error {
			return deleteLegacyModelRoutingOverrides(tx)
		}); err != nil {
			return err
		}
		common.SysLog(fmt.Sprintf(
			"cleared %d legacy model routing overrides for unavailable channel %d",
			len(legacy), targetChannelID,
		))
		return nil
	}
	if err != nil {
		return err
	}

	normalized, err := buildChannelModelRoutingOverrides(targetChannelID, true)
	if err != nil {
		if err := legacyQuery.Update("scope", modelRoutingOverrideScopeChannel).Error; err != nil {
			return err
		}
		common.SysLog(fmt.Sprintf(
			"preserved %d legacy model routing overrides for channel %d without expansion: %v",
			len(legacy), targetChannelID, err,
		))
		return nil
	}
	if err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("channel_id = ?", targetChannelID).Delete(&ModelRoutingOverride{}).Error; err != nil {
			return err
		}
		if err := deleteLegacyModelRoutingOverrides(tx); err != nil {
			return err
		}
		return tx.Create(&normalized).Error
	}); err != nil {
		return err
	}
	common.SysLog(fmt.Sprintf(
		"migrated %d legacy model routing overrides to %d channel-wide rules for channel %d",
		len(legacy), len(normalized), targetChannelID,
	))
	return nil
}

// buildEligibleChannelModelRoutingOverrides checks that channelID can host
// temporary routing and returns the rules it would own.
func buildEligibleChannelModelRoutingOverrides(channelID int) ([]ModelRoutingOverride, error) {
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
	return buildChannelModelRoutingOverrides(channelID, true)
}

// PreviewChannelModelRoutingOverrideConflicts reports the channels that enabling
// temporary routing for channelID would have to release, without writing
// anything. Callers use it to warn before asking for confirmation.
func PreviewChannelModelRoutingOverrideConflicts(channelID int) ([]ModelRoutingOverrideConflict, error) {
	overrides, err := buildEligibleChannelModelRoutingOverrides(channelID)
	if err != nil {
		return nil, err
	}
	return findModelRoutingOverrideConflicts(DB, channelID, overrides)
}

// SetChannelModelRoutingOverride adds or refreshes the temporary routing rules
// for channelID. A channel may coexist with other temporary targets when its
// effective model set does not overlap theirs. Overlapping targets block the
// write unless replaceConflicts is set, which releases them first: temporary
// routing is channel-wide, so a conflicting channel is cleared as a whole rather
// than trimmed down to a subset of its abilities.
func SetChannelModelRoutingOverride(channelID int, replaceConflicts bool) (ModelRoutingOverrideResult, error) {
	overrides, err := buildEligibleChannelModelRoutingOverrides(channelID)
	if err != nil {
		return ModelRoutingOverrideResult{}, err
	}

	modelRoutingOverrideMutationLock.Lock()
	defer modelRoutingOverrideMutationLock.Unlock()

	var conflicts []ModelRoutingOverrideConflict
	if err := DB.Transaction(func(tx *gorm.DB) error {
		found, err := findModelRoutingOverrideConflicts(tx, channelID, overrides)
		if err != nil {
			return err
		}
		conflicts = found
		if len(conflicts) > 0 {
			if !replaceConflicts {
				// Leave the decision to the caller; nothing is persisted.
				return nil
			}
			releasedChannelIDs := make([]int, 0, len(conflicts))
			for _, conflict := range conflicts {
				releasedChannelIDs = append(releasedChannelIDs, conflict.ChannelId)
			}
			if _, err := deleteModelRoutingOverridesByChannelIDs(tx, releasedChannelIDs); err != nil {
				return err
			}
		}
		if err := tx.Where("channel_id = ?", channelID).Delete(&ModelRoutingOverride{}).Error; err != nil {
			return err
		}
		return tx.Create(&overrides).Error
	}); err != nil {
		return ModelRoutingOverrideResult{}, err
	}
	if len(conflicts) > 0 && !replaceConflicts {
		return ModelRoutingOverrideResult{Conflicts: conflicts}, nil
	}
	if err := refreshModelRoutingOverrideCache(); err != nil {
		return ModelRoutingOverrideResult{}, err
	}
	return ModelRoutingOverrideResult{
		Applied:   true,
		Overrides: overrides,
		Conflicts: conflicts,
	}, nil
}

// SetModelRoutingOverride is retained for source compatibility with older
// callers. Temporary routing is now channel-scoped, and conflicts surface as an
// error because this signature cannot carry them.
func SetModelRoutingOverride(modelName string, channelID int) ([]ModelRoutingOverride, error) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" || len(modelName) > 255 {
		return nil, errors.New("invalid model name")
	}
	result, err := SetChannelModelRoutingOverride(channelID, false)
	if err != nil {
		return nil, err
	}
	if !result.Applied {
		return nil, ModelRoutingOverrideConflictError(result.Conflicts)
	}
	return result.Overrides, nil
}

func DeleteModelRoutingOverride(modelName string) (int64, error) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return 0, errors.New("invalid model name")
	}
	modelRoutingOverrideMutationLock.Lock()
	defer modelRoutingOverrideMutationLock.Unlock()
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
	modelRoutingOverrideMutationLock.Lock()
	defer modelRoutingOverrideMutationLock.Unlock()
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
	modelRoutingOverrideMutationLock.Lock()
	defer modelRoutingOverrideMutationLock.Unlock()
	deleted, err := deleteModelRoutingOverridesByChannelIDs(DB, channelIDs)
	if err != nil {
		return 0, err
	}
	if err := refreshModelRoutingOverrideCache(); err != nil {
		return 0, err
	}
	return deleted, nil
}
