package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGetRandomSatisfiedChannelContinuesFromPreviousPriority(t *testing.T) {
	for _, memoryCacheEnabled := range []bool{false, true} {
		name := "database"
		if memoryCacheEnabled {
			name = "memory_cache"
		}
		t.Run(name, func(t *testing.T) {
			originalDB := DB
			originalMemoryCacheEnabled := common.MemoryCacheEnabled
			originalMainDatabaseType := common.MainDatabaseType()
			originalLogDatabaseType := common.LogDatabaseType()

			channelSyncLock.Lock()
			originalGroupChannels := group2model2channels
			originalChannels := channelsIDM
			originalAdvancedConfigs := channel2advancedCustomConfig
			channelSyncLock.Unlock()

			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)

			DB = db
			common.MemoryCacheEnabled = memoryCacheEnabled
			common.SetDatabaseTypes(common.DatabaseTypeSQLite, originalLogDatabaseType)
			initCol()

			t.Cleanup(func() {
				DB = originalDB
				common.MemoryCacheEnabled = originalMemoryCacheEnabled
				common.SetDatabaseTypes(originalMainDatabaseType, originalLogDatabaseType)
				initCol()

				channelSyncLock.Lock()
				group2model2channels = originalGroupChannels
				channelsIDM = originalChannels
				channel2advancedCustomConfig = originalAdvancedConfigs
				channelSyncLock.Unlock()
				require.NoError(t, sqlDB.Close())
			})

			require.NoError(t, db.AutoMigrate(&Channel{}, &Ability{}))

			channels := []Channel{
				{Id: 101, Name: "primary", Key: "key-101", Status: common.ChannelStatusEnabled, Models: "gpt-5.5", Group: "default", Priority: common.GetPointer(int64(200))},
				{Id: 3, Name: "backup", Key: "key-3", Status: common.ChannelStatusEnabled, Models: "gpt-5.5", Group: "default", Priority: common.GetPointer(int64(5))},
				{Id: 162, Name: "fallback", Key: "key-162", Status: common.ChannelStatusEnabled, Models: "gpt-5.5", Group: "default", Priority: common.GetPointer(int64(1))},
			}
			for i := range channels {
				require.NoError(t, db.Create(&channels[i]).Error)
				require.NoError(t, channels[i].UpdateAbilities(nil))
			}
			if memoryCacheEnabled {
				InitChannelCache()
			}

			primary, err := GetRandomSatisfiedChannel("default", "gpt-5.5", 0, "", nil)
			require.NoError(t, err)
			require.NotNil(t, primary)
			assert.Equal(t, 101, primary.Id)

			require.NoError(t, UpdateAbilityStatus(primary.Id, false))
			CacheUpdateChannelStatus(primary.Id, common.ChannelStatusAutoDisabled)
			previousPriority := primary.GetPriority()
			backup, err := GetRandomSatisfiedChannel("default", "gpt-5.5", 1, "", &previousPriority)
			require.NoError(t, err)
			require.NotNil(t, backup)
			assert.Equal(t, 3, backup.Id)

			require.NoError(t, UpdateAbilityStatus(backup.Id, false))
			CacheUpdateChannelStatus(backup.Id, common.ChannelStatusAutoDisabled)
			previousPriority = backup.GetPriority()
			fallback, err := GetRandomSatisfiedChannel("default", "gpt-5.5", 2, "", &previousPriority)
			require.NoError(t, err)
			require.NotNil(t, fallback)
			assert.Equal(t, 162, fallback.Id)
		})
	}
}
