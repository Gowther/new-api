package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupTokenModelLimitsTestDB(t *testing.T) *gorm.DB {
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
	require.NoError(t, db.AutoMigrate(&Token{}, &Ability{}))

	t.Cleanup(func() {
		DB = originalDB
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		common.SetDatabaseTypes(originalMainDatabaseType, originalLogDatabaseType)
		initCol()
		_ = sqlDB.Close()
	})
	return db
}

func createTokenWithLimits(t *testing.T, userId int, name string, enabled bool, limits string) Token {
	t.Helper()
	token := Token{
		UserId:             userId,
		Name:               name,
		Key:                name + "-key",
		Status:             common.TokenStatusEnabled,
		ModelLimitsEnabled: enabled,
		ModelLimits:        limits,
	}
	require.NoError(t, DB.Create(&token).Error)
	return token
}

func createEnabledAbilityModel(t *testing.T, modelName string) {
	t.Helper()
	require.NoError(t, DB.Create(&Ability{
		Group:     "default",
		Model:     modelName,
		ChannelId: 1,
		Enabled:   true,
	}).Error)
}

func TestGetUserStaleTokenModelLimitsReportsOnlyUnservedModels(t *testing.T) {
	setupTokenModelLimitsTestDB(t)
	createEnabledAbilityModel(t, "gpt-4o")

	owner := createTokenWithLimits(t, 1, "limits", true, "gpt-4o,dead-model")
	createTokenWithLimits(t, 1, "no-limits", false, "another-dead-model")
	createTokenWithLimits(t, 2, "other-user", true, "dead-model")

	report, err := GetUserStaleTokenModelLimits(1)
	require.NoError(t, err)
	assert.Equal(t, []string{"dead-model"}, report.StaleModels)
	require.Len(t, report.Tokens, 1)
	assert.Equal(t, owner.Id, report.Tokens[0].TokenId)
	assert.Equal(t, "limits", report.Tokens[0].TokenName)
	assert.Equal(t, []string{"dead-model"}, report.Tokens[0].StaleModels)
}

func TestCleanupStaleTokenModelLimitsKeepsServedModels(t *testing.T) {
	setupTokenModelLimitsTestDB(t)
	createEnabledAbilityModel(t, "gpt-4o")
	token := createTokenWithLimits(t, 1, "mixed", true, "gpt-4o,dead-model")

	changed, err := CleanupStaleTokenModelLimits(1, []int{token.Id})
	require.NoError(t, err)
	assert.Equal(t, 1, changed)

	cleanToken, err := GetTokenByIds(token.Id, 1)
	require.NoError(t, err)
	assert.True(t, cleanToken.ModelLimitsEnabled)
	assert.Equal(t, "gpt-4o", cleanToken.ModelLimits)
}

func TestCleanupStaleTokenModelLimitsDisablesEmptyLimits(t *testing.T) {
	setupTokenModelLimitsTestDB(t)
	token := createTokenWithLimits(t, 1, "all-stale", true, "dead-model,another-dead")

	changed, err := CleanupStaleTokenModelLimits(1, []int{token.Id})
	require.NoError(t, err)
	assert.Equal(t, 1, changed)

	cleanToken, err := GetTokenByIds(token.Id, 1)
	require.NoError(t, err)
	assert.False(t, cleanToken.ModelLimitsEnabled)
	assert.Empty(t, cleanToken.ModelLimits)
}

func TestCleanupStaleTokenModelLimitsIgnoresOtherUsersAndCleanTokens(t *testing.T) {
	setupTokenModelLimitsTestDB(t)
	createEnabledAbilityModel(t, "gpt-4o")
	mine := createTokenWithLimits(t, 1, "mine", true, "gpt-4o")
	others := createTokenWithLimits(t, 2, "theirs", true, "dead-model")
	staleMine := createTokenWithLimits(t, 1, "stale", true, "dead-model")

	changed, err := CleanupStaleTokenModelLimits(1, []int{mine.Id, others.Id, staleMine.Id})
	require.NoError(t, err)
	assert.Equal(t, 1, changed)

	mineAfter, err := GetTokenByIds(mine.Id, 1)
	require.NoError(t, err)
	assert.Equal(t, "gpt-4o", mineAfter.ModelLimits)

	othersAfter, err := GetTokenById(others.Id)
	require.NoError(t, err)
	assert.Equal(t, "dead-model", othersAfter.ModelLimits)
}
