package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGetAllLogsIncludesCurrentChannelDisplayMetadata(t *testing.T) {
	originalDB := DB
	originalLogDB := LOG_DB
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	originalMainDatabaseType := common.MainDatabaseType()
	originalLogDatabaseType := common.LogDatabaseType()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)

	DB = db
	LOG_DB = db
	common.MemoryCacheEnabled = false
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, db.AutoMigrate(&Channel{}, &Log{}))

	t.Cleanup(func() {
		DB = originalDB
		LOG_DB = originalLogDB
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		common.SetDatabaseTypes(originalMainDatabaseType, originalLogDatabaseType)
		require.NoError(t, sqlDB.Close())
	})

	remark := "Provider status: https://status.example.com"
	channel := Channel{
		Name:   "usage log channel",
		Key:    "test-key",
		Status: common.ChannelStatusEnabled,
		Models: "test-model",
		Group:  "default",
		Remark: &remark,
	}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, db.Create(&Log{
		CreatedAt: 1,
		Type:      LogTypeConsume,
		ChannelId: channel.Id,
	}).Error)

	logs, total, err := GetAllLogs(
		LogTypeUnknown,
		0,
		0,
		"",
		"",
		"",
		0,
		10,
		0,
		"",
		"",
		"",
	)

	require.NoError(t, err)
	require.Len(t, logs, 1)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, channel.Name, logs[0].ChannelName)
	assert.Equal(t, remark, logs[0].ChannelRemark)
}
