package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupModelRoutingOverrideTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	originalDB := DB
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	originalMainDatabaseType := common.MainDatabaseType()
	originalLogDatabaseType := common.LogDatabaseType()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)

	DB = db
	common.MemoryCacheEnabled = false
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, originalLogDatabaseType)
	initCol()
	require.NoError(t, db.AutoMigrate(&Channel{}, &Ability{}, &ModelRoutingOverride{}))

	t.Cleanup(func() {
		DB = originalDB
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		common.SetDatabaseTypes(originalMainDatabaseType, originalLogDatabaseType)
		initCol()
		if originalMemoryCacheEnabled && originalDB != nil {
			_ = InitModelRoutingOverrideCache()
		}
		_ = sqlDB.Close()
	})
	return db
}

func createRoutingTestChannel(t *testing.T, db *gorm.DB, id int, models string, groups string) Channel {
	t.Helper()
	channel := Channel{
		Id:     id,
		Name:   "routing channel",
		Key:    "key",
		Status: common.ChannelStatusEnabled,
		Models: models,
		Group:  groups,
	}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, channel.UpdateAbilities(nil))
	return channel
}

func TestModelRoutingOverrideLifecycle(t *testing.T) {
	db := setupModelRoutingOverrideTestDB(t)
	channelA := createRoutingTestChannel(t, db, 41, "model-a,shared-model", "default,premium")
	channelB := createRoutingTestChannel(t, db, 42, "shared-model,model-b", "default")

	overrides, err := SetChannelModelRoutingOverride(channelA.Id)
	require.NoError(t, err)
	assert.Len(t, overrides, 4)
	for _, override := range overrides {
		assert.Equal(t, channelA.Id, override.ChannelId)
		assert.Equal(t, modelRoutingOverrideScopeChannel, override.Scope)
	}

	for _, modelName := range []string{"model-a", "shared-model"} {
		channelID, found, err := GetModelRoutingOverrideTarget(modelName)
		require.NoError(t, err)
		assert.True(t, found)
		assert.Equal(t, channelA.Id, channelID)
	}

	// A channel status/ability outage does not silently leave temporary mode.
	require.NoError(t, UpdateAbilityStatus(channelA.Id, false))
	channelID, found, err := GetModelRoutingOverrideTarget("model-a")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, channelA.Id, channelID)

	// Switching channels is atomic: old rules disappear, and only B's enabled
	// model/group abilities are covered.
	overrides, err = SetChannelModelRoutingOverride(channelB.Id)
	require.NoError(t, err)
	assert.Len(t, overrides, 2)
	_, found, err = GetModelRoutingOverrideTarget("model-a")
	require.NoError(t, err)
	assert.False(t, found)
	channelID, found, err = GetModelRoutingOverrideTarget("shared-model")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, channelB.Id, channelID)
	channelID, found, err = GetModelRoutingOverrideTarget("model-b")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, channelB.Id, channelID)

	deleted, err := DeleteAllModelRoutingOverrides()
	require.NoError(t, err)
	assert.EqualValues(t, 2, deleted)
	_, found, err = GetModelRoutingOverrideTarget("shared-model")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestModelRoutingOverrideSupportsNormalizedAbilities(t *testing.T) {
	db := setupModelRoutingOverrideTestDB(t)
	wildcardChannel := createRoutingTestChannel(t, db, 43, "gpt-4-gizmo-*", "default")

	overrides, err := SetChannelModelRoutingOverride(wildcardChannel.Id)
	require.NoError(t, err)
	require.Len(t, overrides, 1)
	assert.Equal(t, "gpt-4-gizmo-*", overrides[0].Model)

	for _, modelName := range []string{"gpt-4-gizmo-alpha", "gpt-4-gizmo-beta"} {
		channelID, found, err := GetModelRoutingOverrideTarget(modelName)
		require.NoError(t, err)
		assert.True(t, found)
		assert.Equal(t, wildcardChannel.Id, channelID)
	}

	common.MemoryCacheEnabled = true
	require.NoError(t, InitModelRoutingOverrideCache())
	channelID, found, err := GetModelRoutingOverrideTarget("gpt-4-gizmo-alpha")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, wildcardChannel.Id, channelID)
}

func TestSetChannelModelRoutingOverrideRejectsUnsupportedOrDisabledChannel(t *testing.T) {
	db := setupModelRoutingOverrideTestDB(t)
	channel := Channel{Id: 52, Name: "candidate", Key: "key", Status: common.ChannelStatusEnabled}
	require.NoError(t, db.Create(&channel).Error)
	_, err := SetChannelModelRoutingOverride(channel.Id)
	require.ErrorContains(t, err, "does not have any enabled model ability")

	disabled := createRoutingTestChannel(t, db, 53, "gpt-4.1", "default")
	require.NoError(t, db.Model(&Channel{}).Where("id = ?", disabled.Id).Update("status", common.ChannelStatusManuallyDisabled).Error)
	_, err = SetChannelModelRoutingOverride(disabled.Id)
	require.ErrorContains(t, err, "target channel is disabled")
}

func TestModelRoutingOverrideCleanupLifecycle(t *testing.T) {
	db := setupModelRoutingOverrideTestDB(t)
	channel := createRoutingTestChannel(t, db, 61, "cleanup-model", "default")
	_, err := SetChannelModelRoutingOverride(channel.Id)
	require.NoError(t, err)

	assert.True(t, UpdateChannelStatus(channel.Id, "", common.ChannelStatusAutoDisabled, "automatic failure"))
	_, found, err := GetModelRoutingOverrideTarget("cleanup-model")
	require.NoError(t, err)
	assert.True(t, found, "automatic disable must preserve temporary mode")

	assert.True(t, UpdateChannelStatus(channel.Id, "", common.ChannelStatusManuallyDisabled, "manual operation"))
	_, found, err = GetModelRoutingOverrideTarget("cleanup-model")
	require.NoError(t, err)
	assert.False(t, found)

	channel = createRoutingTestChannel(t, db, 62, "edit-model", "default")
	_, err = SetChannelModelRoutingOverride(channel.Id)
	require.NoError(t, err)
	updated, err := GetChannelById(channel.Id, true)
	require.NoError(t, err)
	updated.Models = "edited-model"
	require.NoError(t, updated.Update())
	_, found, err = GetModelRoutingOverrideTarget("edit-model")
	require.NoError(t, err)
	assert.False(t, found)

	channel = createRoutingTestChannel(t, db, 63, "delete-model", "default")
	_, err = SetChannelModelRoutingOverride(channel.Id)
	require.NoError(t, err)
	require.NoError(t, channel.Delete())
	_, found, err = GetModelRoutingOverrideTarget("delete-model")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestFailedManualDisablePreservesModelRoutingOverride(t *testing.T) {
	db := setupModelRoutingOverrideTestDB(t)
	channel := Channel{
		Id:     64,
		Name:   "multi-key routing channel",
		Key:    "first-key\nsecond-key",
		Status: common.ChannelStatusEnabled,
		Models: "multi-key-model",
		Group:  "default",
		ChannelInfo: ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: 2,
		},
	}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, channel.UpdateAbilities(nil))
	_, err := SetChannelModelRoutingOverride(channel.Id)
	require.NoError(t, err)

	assert.False(t, UpdateChannelStatus(channel.Id, "missing-key", common.ChannelStatusManuallyDisabled, "manual operation"))
	channelID, found, err := GetModelRoutingOverrideTarget("multi-key-model")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, channel.Id, channelID)
}

func TestRepeatedManualDisableClearsStaleModelRoutingOverride(t *testing.T) {
	db := setupModelRoutingOverrideTestDB(t)
	channel := createRoutingTestChannel(t, db, 65, "stale-model", "default")
	require.NoError(t, db.Model(&Channel{}).Where("id = ?", channel.Id).Update("status", common.ChannelStatusManuallyDisabled).Error)
	require.NoError(t, db.Create(&ModelRoutingOverride{
		Model:     "stale-model",
		Group:     "default",
		ChannelId: channel.Id,
	}).Error)

	assert.False(t, UpdateChannelStatus(channel.Id, "", common.ChannelStatusManuallyDisabled, "manual operation"))
	_, found, err := GetModelRoutingOverrideTarget("stale-model")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestMigrateLegacyModelRoutingOverridesExpandsSingleChannelOnce(t *testing.T) {
	db := setupModelRoutingOverrideTestDB(t)
	channel := createRoutingTestChannel(t, db, 66, "legacy-a,legacy-b", "default,premium")
	require.NoError(t, db.Create(&ModelRoutingOverride{
		Model:     "legacy-a",
		Group:     "default",
		ChannelId: channel.Id,
	}).Error)

	require.NoError(t, migrateLegacyModelRoutingOverrides())
	overrides, err := GetAllModelRoutingOverrides()
	require.NoError(t, err)
	require.Len(t, overrides, 4)
	for _, override := range overrides {
		assert.Equal(t, channel.Id, override.ChannelId)
		assert.Equal(t, modelRoutingOverrideScopeChannel, override.Scope)
	}

	require.NoError(t, db.Create(&Ability{
		Group:     "default",
		Model:     "future-model",
		ChannelId: channel.Id,
		Enabled:   true,
	}).Error)
	require.NoError(t, migrateLegacyModelRoutingOverrides())
	overrides, err = GetAllModelRoutingOverrides()
	require.NoError(t, err)
	assert.Len(t, overrides, 4, "completed migrations must not rebuild persisted channel-wide rules")
}

func TestMigrateLegacyModelRoutingOverridesClearsAmbiguousTargets(t *testing.T) {
	db := setupModelRoutingOverrideTestDB(t)
	channelA := createRoutingTestChannel(t, db, 67, "legacy-a", "default")
	channelB := createRoutingTestChannel(t, db, 68, "legacy-b", "default")
	require.NoError(t, db.Create(&[]ModelRoutingOverride{
		{Model: "legacy-a", Group: "default", ChannelId: channelA.Id},
		{Model: "legacy-b", Group: "default", ChannelId: channelB.Id},
	}).Error)

	require.NoError(t, migrateLegacyModelRoutingOverrides())
	overrides, err := GetAllModelRoutingOverrides()
	require.NoError(t, err)
	assert.Empty(t, overrides)
}
