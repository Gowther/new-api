package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestModelRoutingOverrideLifecycle(t *testing.T) {
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
	t.Cleanup(func() {
		DB = originalDB
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		common.SetDatabaseTypes(originalMainDatabaseType, originalLogDatabaseType)
		initCol()
		if originalMemoryCacheEnabled {
			require.NoError(t, InitModelRoutingOverrideCache())
		}
		require.NoError(t, sqlDB.Close())
	})

	require.NoError(t, db.AutoMigrate(&Channel{}, &Ability{}, &ModelRoutingOverride{}))
	t.Cleanup(func() {
		_, err := DeleteModelRoutingOverride("gpt-5.5")
		require.NoError(t, err)
	})
	channel := Channel{
		Id:     41,
		Name:   "temporary target",
		Key:    "key-41",
		Status: common.ChannelStatusEnabled,
		Models: "gpt-5.5",
		Group:  "default,premium",
	}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, channel.UpdateAbilities(nil))

	overrides, err := SetModelRoutingOverride("gpt-5.5", channel.Id)
	require.NoError(t, err)
	require.Len(t, overrides, 2)
	assert.Equal(t, "default", overrides[0].Group)
	assert.Equal(t, "premium", overrides[1].Group)

	channelID, found, err := GetModelRoutingOverrideTarget("gpt-5.5")
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, channel.Id, channelID)

	require.NoError(t, UpdateAbilityStatus(channel.Id, false))
	channelID, found, err = GetModelRoutingOverrideTarget("gpt-5.5")
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, channel.Id, channelID, "a disabled target must leave the override in place so routing cannot fall back")

	deleted, err := DeleteModelRoutingOverride("gpt-5.5")
	require.NoError(t, err)
	assert.EqualValues(t, 2, deleted)
	_, found, err = GetModelRoutingOverrideTarget("gpt-5.5")
	require.NoError(t, err)
	assert.False(t, found)

	wildcardChannel := Channel{
		Id:     42,
		Name:   "wildcard target",
		Key:    "key-42",
		Status: common.ChannelStatusEnabled,
		Models: "gpt-4-gizmo-*",
		Group:  "default",
	}
	require.NoError(t, db.Create(&wildcardChannel).Error)
	require.NoError(t, wildcardChannel.UpdateAbilities(nil))

	overrides, err = SetModelRoutingOverride("gpt-4-gizmo-alpha", wildcardChannel.Id)
	require.NoError(t, err)
	require.Len(t, overrides, 1)
	assert.Equal(t, "gpt-4-gizmo-alpha", overrides[0].Model)
	common.MemoryCacheEnabled = true
	require.NoError(t, InitModelRoutingOverrideCache())

	channelID, found, err = GetModelRoutingOverrideTarget("gpt-4-gizmo-alpha")
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, wildcardChannel.Id, channelID)

	_, found, err = GetModelRoutingOverrideTarget("gpt-4-gizmo-beta")
	require.NoError(t, err)
	assert.False(t, found, "a rule for one concrete model must not affect the whole normalized model family")

	deleted, err = DeleteModelRoutingOverride("gpt-4-gizmo-beta")
	require.NoError(t, err)
	assert.Zero(t, deleted)
	_, found, err = GetModelRoutingOverrideTarget("gpt-4-gizmo-alpha")
	require.NoError(t, err)
	assert.True(t, found)

	deleted, err = DeleteModelRoutingOverride("gpt-4-gizmo-alpha")
	require.NoError(t, err)
	assert.EqualValues(t, 1, deleted)
}

func TestSetModelRoutingOverrideRejectsUnsupportedOrDisabledChannel(t *testing.T) {
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
	t.Cleanup(func() {
		DB = originalDB
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		common.SetDatabaseTypes(originalMainDatabaseType, originalLogDatabaseType)
		initCol()
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&Channel{}, &Ability{}, &ModelRoutingOverride{}))
	t.Cleanup(func() {
		_, err := DeleteModelRoutingOverride("gpt-4.1")
		require.NoError(t, err)
	})

	channel := Channel{Id: 52, Name: "candidate", Key: "key-52", Status: common.ChannelStatusEnabled, Models: "gpt-4.1", Group: "default"}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, channel.UpdateAbilities(nil))

	_, err = SetModelRoutingOverride("gpt-5.5", channel.Id)
	require.ErrorContains(t, err, "does not support model")
	require.NoError(t, db.Model(&Channel{}).Where("id = ?", channel.Id).Update("status", common.ChannelStatusManuallyDisabled).Error)
	_, err = SetModelRoutingOverride("gpt-4.1", channel.Id)
	require.ErrorContains(t, err, "target channel is disabled")
}
