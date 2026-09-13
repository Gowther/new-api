package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestMigrateOptionPrimaryKeyRebuildsMissingKey(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)

	// 模拟老部署：options 表在 key 列上没有主键/唯一键，且存在重复 key
	require.NoError(t, db.Exec(`CREATE TABLE options (key TEXT, value TEXT)`).Error)
	require.NoError(t, db.Exec(`INSERT INTO options (key, value) VALUES ('a','1'),('a','2'),('b','3'),('','x')`).Error)

	unique, err := optionsKeyIsUnique(db)
	require.NoError(t, err)
	require.False(t, unique)

	require.NoError(t, migrateOptionPrimaryKey(db))

	unique, err = optionsKeyIsUnique(db)
	require.NoError(t, err)
	require.True(t, unique)

	// 重复 key 按 last-wins 去重，空 key 行被剔除
	var value string
	require.NoError(t, db.Raw(`SELECT value FROM options WHERE key = 'a'`).Scan(&value).Error)
	require.Equal(t, "2", value)
	var count int64
	require.NoError(t, db.Raw(`SELECT count(*) FROM options`).Scan(&count).Error)
	require.Equal(t, int64(2), count)

	// 修复后主键真实生效：重复插入被拒绝
	require.Error(t, db.Exec(`INSERT INTO options (key, value) VALUES ('a','9')`).Error)

	// 幂等：再次执行应直接跳过
	require.NoError(t, migrateOptionPrimaryKey(db))
}

func TestMigrateOptionPrimaryKeySkipsHealthyTable(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)

	require.NoError(t, db.AutoMigrate(&Option{}))
	require.NoError(t, db.Create(&Option{Key: "a", Value: "1"}).Error)

	require.NoError(t, migrateOptionPrimaryKey(db))

	var count int64
	require.NoError(t, db.Raw(`SELECT count(*) FROM options`).Scan(&count).Error)
	require.Equal(t, int64(1), count)
}
