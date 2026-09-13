package model

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

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

func TestUnsetPricingExcludesPricedReferenceAliases(t *testing.T) {
	db := setupModelPricingHealthTestDB(t)
	const (
		pricedModel   = "pricing-health-priced-source"
		boundAlias    = "pricing-health-bound-alias"
		danglingAlias = "pricing-health-dangling-alias"
		unboundAlias  = "pricing-health-unbound-alias"
	)

	prevRatioJSON, err := common.Marshal(ratio_setting.GetModelRatioCopy())
	require.NoError(t, err)
	prevReference := ratio_setting.ModelPriceReference2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(string(prevRatioJSON)))
		require.NoError(t, ratio_setting.UpdateModelPriceReferenceByJSONString(prevReference))
	})

	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"`+pricedModel+`": 1.25}`))
	require.NoError(t, ratio_setting.UpdateModelPriceReferenceByJSONString(`{"`+boundAlias+`": "`+pricedModel+`", "`+danglingAlias+`": "`+unboundAlias+`"}`))

	require.NoError(t, db.Create(&Channel{
		Name:   "pricing health reference channel",
		Key:    "test-key",
		Status: common.ChannelStatusEnabled,
		Models: strings.Join([]string{pricedModel, boundAlias, danglingAlias, unboundAlias}, ","),
		Group:  "default",
	}).Error)

	unsetModels, err := GetEnabledModelsWithoutPricingConfig()
	require.NoError(t, err)
	assert.NotContains(t, unsetModels, pricedModel)
	assert.NotContains(t, unsetModels, boundAlias, "绑定了已定价源模型的别名应视为已定价")
	assert.Contains(t, unsetModels, unboundAlias)
	assert.Contains(t, unsetModels, danglingAlias, "悬空绑定（源模型未定价）仍应出现在未定价列表中")
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

// createChannelCoveringPricedModels 创建一个覆盖所有已有定价条目模型名的渠道，
// 使失效定价检测只可能报告 extraModels 相关的条目。
func createChannelCoveringPricedModels(t *testing.T, db *gorm.DB, name string, extraModels ...string) {
	t.Helper()
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
	modelNames := make([]string, 0, len(coveredModelSet)+len(extraModels))
	for modelName := range coveredModelSet {
		modelNames = append(modelNames, modelName)
	}
	modelNames = append(modelNames, extraModels...)

	require.NoError(t, db.Create(&Channel{
		Name:   name,
		Key:    "test-key",
		Status: common.ChannelStatusEnabled,
		Models: strings.Join(modelNames, ","),
		Group:  "default",
	}).Error)
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

	createChannelCoveringPricedModels(t, db, "existing pricing coverage")

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

func TestStalePricingCoversPriceReferenceBindings(t *testing.T) {
	db := setupModelPricingHealthTestDB(t)
	const (
		liveAlias  = "pricing-health-live-alias"
		staleAlias = "pricing-health-stale-alias"
	)

	common.OptionMapRWMutex.Lock()
	optionMapWasNil := common.OptionMap == nil
	if optionMapWasNil {
		common.OptionMap = make(map[string]string)
	}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		if optionMapWasNil {
			common.OptionMap = nil
		}
		common.OptionMapRWMutex.Unlock()
	})

	prevReference := ratio_setting.ModelPriceReference2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelPriceReferenceByJSONString(prevReference))
	})

	createChannelCoveringPricedModels(t, db, "pricing health bindings channel", liveAlias)

	require.NoError(t, ratio_setting.UpdateModelPriceReferenceByJSONString(
		`{"`+staleAlias+`": "pricing-health-gone-source", "`+liveAlias+`": "pricing-health-live-source"}`))

	report, err := GetStaleModelPricingSettings()
	require.NoError(t, err)
	var staleBinding *StaleModelPricingItem
	for i := range report.Items {
		if report.Items[i].Model == staleAlias {
			staleBinding = &report.Items[i]
		}
	}
	require.NotNil(t, staleBinding, "alias that no longer exists in any channel should be reported as stale")
	assert.Contains(t, staleBinding.Fields, "ModelPriceReference")
	for _, item := range report.Items {
		assert.NotEqual(t, liveAlias, item.Model, "aliases still on a channel must not be reported stale")
	}

	_, err = CleanupStaleModelPricingSettings()
	require.NoError(t, err)
	bindings := ratio_setting.GetModelPriceReferenceCopy()
	assert.NotContains(t, bindings, staleAlias, "stale binding should be removed by cleanup")
	assert.Contains(t, bindings, liveAlias, "live binding must survive cleanup")
}
