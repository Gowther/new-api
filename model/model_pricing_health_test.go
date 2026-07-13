package model

import (
	"sort"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupModelPricingHealthTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	originalDB := DB
	originalLogDB := LOG_DB
	originalMainDatabaseType := common.MainDatabaseType()
	originalLogDatabaseType := common.LogDatabaseType()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)

	DB = db
	LOG_DB = db
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, db.AutoMigrate(&Channel{}, &Ability{}, &Option{}, &Model{}, &Vendor{}))

	t.Cleanup(func() {
		DB = originalDB
		LOG_DB = originalLogDB
		common.SetDatabaseTypes(originalMainDatabaseType, originalLogDatabaseType)
		require.NoError(t, sqlDB.Close())
		RefreshPricing()
	})

	return db
}

func TestUnsetPricingUsesEnabledChannelModels(t *testing.T) {
	db := setupModelPricingHealthTestDB(t)
	const (
		activeModel = "pricing-health-active-model"
		orphanModel = "pricing-health-orphan-model"
	)

	channel := Channel{
		Name:   "pricing health active channel",
		Key:    "test-key",
		Status: common.ChannelStatusEnabled,
		Models: activeModel,
		Group:  "default",
	}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, db.Create(&Ability{
		Group:     "default",
		Model:     orphanModel,
		ChannelId: channel.Id + 1_000_000,
		Enabled:   true,
	}).Error)

	unsetModels, err := GetEnabledModelsWithoutPricingConfig()
	require.NoError(t, err)
	assert.Contains(t, unsetModels, activeModel)
	assert.NotContains(t, unsetModels, orphanModel)
}

func TestDeleteDisabledChannelDeletesAbilities(t *testing.T) {
	db := setupModelPricingHealthTestDB(t)

	disabledChannel := Channel{
		Name:   "disabled channel",
		Key:    "disabled-key",
		Status: common.ChannelStatusManuallyDisabled,
		Models: "disabled-model",
		Group:  "default",
	}
	enabledChannel := Channel{
		Name:   "enabled channel",
		Key:    "enabled-key",
		Status: common.ChannelStatusEnabled,
		Models: "enabled-model",
		Group:  "default",
	}
	require.NoError(t, db.Create(&disabledChannel).Error)
	require.NoError(t, db.Create(&enabledChannel).Error)
	require.NoError(t, db.Create(&[]Ability{
		{
			Group:     "default",
			Model:     disabledChannel.Models,
			ChannelId: disabledChannel.Id,
			Enabled:   false,
		},
		{
			Group:     "default",
			Model:     enabledChannel.Models,
			ChannelId: enabledChannel.Id,
			Enabled:   true,
		},
	}).Error)

	deleted, err := DeleteDisabledChannel()
	require.NoError(t, err)
	assert.Equal(t, int64(1), deleted)

	var disabledChannelCount int64
	require.NoError(t, db.Model(&Channel{}).Where("id = ?", disabledChannel.Id).Count(&disabledChannelCount).Error)
	assert.Zero(t, disabledChannelCount)

	var disabledAbilityCount int64
	require.NoError(t, db.Model(&Ability{}).Where("channel_id = ?", disabledChannel.Id).Count(&disabledAbilityCount).Error)
	assert.Zero(t, disabledAbilityCount)

	var enabledChannelCount int64
	require.NoError(t, db.Model(&Channel{}).Where("id = ?", enabledChannel.Id).Count(&enabledChannelCount).Error)
	assert.Equal(t, int64(1), enabledChannelCount)

	var enabledAbilityCount int64
	require.NoError(t, db.Model(&Ability{}).Where("channel_id = ?", enabledChannel.Id).Count(&enabledAbilityCount).Error)
	assert.Equal(t, int64(1), enabledAbilityCount)
}

func TestCleanupStaleModelPricingRemovesSavedOfficialMapping(t *testing.T) {
	db := setupModelPricingHealthTestDB(t)
	const (
		staleModel    = "pricing-health-stale-official-model"
		wildcardModel = "pricing-health-preserved-*"
	)

	common.OptionMapRWMutex.Lock()
	optionMapWasNil := common.OptionMap == nil
	if optionMapWasNil {
		common.OptionMap = make(map[string]string)
	}
	originalMappings, hadOriginalMappings := common.OptionMap[OfficialPriceModelMappingsOptionKey]
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		if optionMapWasNil {
			common.OptionMap = nil
		} else if hadOriginalMappings {
			common.OptionMap[OfficialPriceModelMappingsOptionKey] = originalMappings
		} else {
			delete(common.OptionMap, OfficialPriceModelMappingsOptionKey)
		}
		common.OptionMapRWMutex.Unlock()
	})

	coveredModelSet := make(map[string]struct{})
	for _, pricingMap := range getModelPricingMaps() {
		for modelName := range pricingMap.Values {
			modelName = strings.TrimSpace(modelName)
			if modelName == "" || strings.Contains(modelName, "*") {
				continue
			}
			coveredModelSet[modelName] = struct{}{}
		}
	}
	coveredModels := make([]string, 0, len(coveredModelSet))
	for modelName := range coveredModelSet {
		coveredModels = append(coveredModels, modelName)
	}
	sort.Strings(coveredModels)
	require.NoError(t, db.Create(&Channel{
		Name:   "existing pricing coverage",
		Key:    "test-key",
		Status: common.ChannelStatusEnabled,
		Models: strings.Join(coveredModels, ","),
		Group:  "default",
	}).Error)

	mappings := make(map[string]any)
	if strings.TrimSpace(originalMappings) != "" {
		require.NoError(t, common.UnmarshalJsonStr(originalMappings, &mappings))
	}
	mappings[staleModel] = map[string]any{
		"source":         "models.dev",
		"upstream_model": staleModel,
	}
	mappings[wildcardModel] = map[string]any{
		"source":         "models.dev",
		"upstream_model": wildcardModel,
	}
	rawMappings, err := common.Marshal(mappings)
	require.NoError(t, err)
	require.NoError(t, UpdateOption(OfficialPriceModelMappingsOptionKey, string(rawMappings)))

	report, err := CleanupStaleModelPricingSettings()
	require.NoError(t, err)
	require.Equal(t, 1, report.Total)
	require.Len(t, report.Items, 1)
	assert.Equal(t, staleModel, report.Items[0].Model)
	assert.Contains(t, report.Items[0].Fields, OfficialPriceModelMappingsOptionKey)

	common.OptionMapRWMutex.RLock()
	cleanedRawMappings := common.OptionMap[OfficialPriceModelMappingsOptionKey]
	common.OptionMapRWMutex.RUnlock()
	var cleanedMappings map[string]any
	require.NoError(t, common.UnmarshalJsonStr(cleanedRawMappings, &cleanedMappings))
	assert.NotContains(t, cleanedMappings, staleModel)
	assert.Contains(t, cleanedMappings, wildcardModel)

	var persisted Option
	require.NoError(t, db.First(&persisted, "key = ?", OfficialPriceModelMappingsOptionKey).Error)
	var persistedMappings map[string]any
	require.NoError(t, common.UnmarshalJsonStr(persisted.Value, &persistedMappings))
	assert.NotContains(t, persistedMappings, staleModel)
	assert.Contains(t, persistedMappings, wildcardModel)
}
