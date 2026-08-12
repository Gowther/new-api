package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestBatchInsertChannelsRefreshesMemoryCache(t *testing.T) {
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
	common.MemoryCacheEnabled = true
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, originalLogDatabaseType)
	initCol()
	channelSyncLock.Lock()
	originalGroupChannels := group2model2channels
	originalChannels := channelsIDM
	originalAdvancedConfigs := channel2advancedCustomConfig
	channelSyncLock.Unlock()

	t.Cleanup(func() {
		DB = originalDB
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		common.SetDatabaseTypes(originalMainDatabaseType, originalLogDatabaseType)
		channelSyncLock.Lock()
		group2model2channels = originalGroupChannels
		channelsIDM = originalChannels
		channel2advancedCustomConfig = originalAdvancedConfigs
		channelSyncLock.Unlock()
		initCol()
		require.NoError(t, sqlDB.Close())
	})

	require.NoError(t, db.AutoMigrate(&Channel{}, &Ability{}))
	InitChannelCache()

	channel := Channel{
		Name:   "new-playground-channel",
		Key:    "test-key",
		Status: common.ChannelStatusEnabled,
		Models: "playground-model",
		Group:  "default",
	}
	require.NoError(t, BatchInsertChannels([]Channel{channel}))

	selected, err := GetRandomSatisfiedChannel("default", "playground-model", 0, "", nil)
	require.NoError(t, err)
	require.NotNil(t, selected)
	require.Equal(t, channel.Name, selected.Name)
}
