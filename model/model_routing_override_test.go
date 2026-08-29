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

// enableRoutingOverride applies temporary routing without confirming any
// replacement, asserting the channel was free of conflicts.
func enableRoutingOverride(t *testing.T, channelID int) []ModelRoutingOverride {
	t.Helper()
	result, err := SetChannelModelRoutingOverride(channelID, false)
	require.NoError(t, err)
	require.True(t, result.Applied, "expected no conflicts, got %+v", result.Conflicts)
	return result.Overrides
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

	overrides := enableRoutingOverride(t, channelA.Id)
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
	assert.Len(t, enableRoutingOverride(t, channelA.Id), 4)

	// A channel status/ability outage does not silently leave temporary mode.
	require.NoError(t, UpdateAbilityStatus(channelA.Id, false))
	channelID, found, err := GetModelRoutingOverrideTarget("model-a")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, channelA.Id, channelID)

	// Overlapping models block the write and the existing channel stays active.
	result, err := SetChannelModelRoutingOverride(channelB.Id, false)
	require.NoError(t, err)
	assert.False(t, result.Applied)
	assert.Empty(t, result.Overrides)
	channelID, found, err = GetModelRoutingOverrideTarget("shared-model")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, channelA.Id, channelID)

	// A disjoint channel can be enabled alongside the existing target.
	channelC := createRoutingTestChannel(t, db, 43, "model-b", "default")
	assert.Len(t, enableRoutingOverride(t, channelC.Id), 1)
	channelID, found, err = GetModelRoutingOverrideTarget("model-a")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, channelA.Id, channelID)
	channelID, found, err = GetModelRoutingOverrideTarget("model-b")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, channelC.Id, channelID)

	common.MemoryCacheEnabled = true
	require.NoError(t, InitModelRoutingOverrideCache())
	channelID, found, err = GetModelRoutingOverrideTarget("model-a")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, channelA.Id, channelID)
	channelID, found, err = GetModelRoutingOverrideTarget("model-b")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, channelC.Id, channelID)
	common.MemoryCacheEnabled = false

	deleted, err := DeleteModelRoutingOverridesByChannelIDs([]int{channelA.Id})
	require.NoError(t, err)
	assert.EqualValues(t, 4, deleted)
	_, found, err = GetModelRoutingOverrideTarget("model-a")
	require.NoError(t, err)
	assert.False(t, found)
	channelID, found, err = GetModelRoutingOverrideTarget("model-b")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, channelC.Id, channelID)

	deleted, err = DeleteAllModelRoutingOverrides()
	require.NoError(t, err)
	assert.EqualValues(t, 1, deleted)
	_, found, err = GetModelRoutingOverrideTarget("shared-model")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestModelRoutingOverrideReportsNormalizedModelConflicts(t *testing.T) {
	db := setupModelRoutingOverrideTestDB(t)
	wildcardChannel := createRoutingTestChannel(t, db, 44, "gpt-4-gizmo-*", "default")
	variantChannel := createRoutingTestChannel(t, db, 45, "gpt-4-gizmo-alpha", "default")

	enableRoutingOverride(t, wildcardChannel.Id)
	// The variant only matches through normalization, so the conflict has to
	// name the wildcard rule the operator would be releasing.
	result, err := SetChannelModelRoutingOverride(variantChannel.Id, false)
	require.NoError(t, err)
	assert.False(t, result.Applied)
	require.Len(t, result.Conflicts, 1)
	assert.Equal(t, wildcardChannel.Id, result.Conflicts[0].ChannelId)
	assert.Equal(t, []string{"gpt-4-gizmo-*"}, result.Conflicts[0].Models)
	require.ErrorContains(t, ModelRoutingOverrideConflictError(result.Conflicts), "gpt-4-gizmo-*")

	channelID, found, err := GetModelRoutingOverrideTarget("gpt-4-gizmo-alpha")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, wildcardChannel.Id, channelID)
}

func TestModelRoutingOverridePreviewsAndReplacesConflicts(t *testing.T) {
	db := setupModelRoutingOverrideTestDB(t)
	channelA := createRoutingTestChannel(t, db, 46, "shared-model,only-a", "default")
	channelB := createRoutingTestChannel(t, db, 47, "shared-model,only-b", "default")
	disjoint := createRoutingTestChannel(t, db, 48, "only-c", "default")

	enableRoutingOverride(t, channelA.Id)

	conflicts, err := PreviewChannelModelRoutingOverrideConflicts(channelB.Id)
	require.NoError(t, err)
	require.Len(t, conflicts, 1)
	assert.Equal(t, channelA.Id, conflicts[0].ChannelId)
	assert.Equal(t, channelA.Name, conflicts[0].ChannelName)
	assert.Equal(t, []string{"shared-model"}, conflicts[0].Models)

	// The preview must not write: A still owns the overlapping model.
	channelID, found, err := GetModelRoutingOverrideTarget("shared-model")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, channelA.Id, channelID)

	disjointConflicts, err := PreviewChannelModelRoutingOverrideConflicts(disjoint.Id)
	require.NoError(t, err)
	assert.Empty(t, disjointConflicts)

	// Confirming the replacement releases A as a whole, including the models it
	// did not share with B, because temporary routing is channel-wide.
	result, err := SetChannelModelRoutingOverride(channelB.Id, true)
	require.NoError(t, err)
	require.True(t, result.Applied)
	assert.Len(t, result.Overrides, 2)
	require.Len(t, result.Conflicts, 1)
	assert.Equal(t, channelA.Id, result.Conflicts[0].ChannelId)

	for _, modelName := range []string{"shared-model", "only-b"} {
		channelID, found, err = GetModelRoutingOverrideTarget(modelName)
		require.NoError(t, err)
		assert.True(t, found)
		assert.Equal(t, channelB.Id, channelID)
	}
	_, found, err = GetModelRoutingOverrideTarget("only-a")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestModelRoutingOverrideSupportsNormalizedAbilities(t *testing.T) {
	db := setupModelRoutingOverrideTestDB(t)
	wildcardChannel := createRoutingTestChannel(t, db, 43, "gpt-4-gizmo-*", "default")

	overrides := enableRoutingOverride(t, wildcardChannel.Id)
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
	_, err := SetChannelModelRoutingOverride(channel.Id, false)
	require.ErrorContains(t, err, "does not have any enabled model ability")
	// The preflight rejects the same channels, so the prompt never opens on one.
	_, err = PreviewChannelModelRoutingOverrideConflicts(channel.Id)
	require.ErrorContains(t, err, "does not have any enabled model ability")

	disabled := createRoutingTestChannel(t, db, 53, "gpt-4.1", "default")
	require.NoError(t, db.Model(&Channel{}).Where("id = ?", disabled.Id).Update("status", common.ChannelStatusManuallyDisabled).Error)
	_, err = SetChannelModelRoutingOverride(disabled.Id, false)
	require.ErrorContains(t, err, "target channel is disabled")
	_, err = PreviewChannelModelRoutingOverrideConflicts(disabled.Id)
	require.ErrorContains(t, err, "target channel is disabled")
}

func TestModelRoutingOverrideCleanupLifecycle(t *testing.T) {
	db := setupModelRoutingOverrideTestDB(t)
	// Temporary routing fails closed, so leaving the rule on a channel that
	// stopped serving would take its models down until someone intervened.
	// Both kinds of disable release it.
	channel := createRoutingTestChannel(t, db, 61, "cleanup-model", "default")
	enableRoutingOverride(t, channel.Id)
	assert.True(t, UpdateChannelStatus(channel.Id, "", common.ChannelStatusAutoDisabled, "automatic failure"))
	_, found, err := GetModelRoutingOverrideTarget("cleanup-model")
	require.NoError(t, err)
	assert.False(t, found, "automatic disable must release temporary mode")

	channel = createRoutingTestChannel(t, db, 64, "manual-cleanup-model", "default")
	enableRoutingOverride(t, channel.Id)
	assert.True(t, UpdateChannelStatus(channel.Id, "", common.ChannelStatusManuallyDisabled, "manual operation"))
	_, found, err = GetModelRoutingOverrideTarget("manual-cleanup-model")
	require.NoError(t, err)
	assert.False(t, found)

	channel = createRoutingTestChannel(t, db, 62, "edit-model", "default")
	enableRoutingOverride(t, channel.Id)
	updated, err := GetChannelById(channel.Id, true)
	require.NoError(t, err)
	updated.Models = "edited-model"
	require.NoError(t, updated.Update())
	_, found, err = GetModelRoutingOverrideTarget("edit-model")
	require.NoError(t, err)
	assert.False(t, found)

	channel = createRoutingTestChannel(t, db, 63, "delete-model", "default")
	enableRoutingOverride(t, channel.Id)
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
	enableRoutingOverride(t, channel.Id)

	assert.False(t, UpdateChannelStatus(channel.Id, "missing-key", common.ChannelStatusManuallyDisabled, "manual operation"))
	channelID, found, err := GetModelRoutingOverrideTarget("multi-key-model")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, channel.Id, channelID)
}

func createMultiKeyRoutingTestChannel(t *testing.T, db *gorm.DB, id int, models string) Channel {
	t.Helper()
	channel := Channel{
		Id:     id,
		Name:   "multi-key routing target",
		Key:    "first-key\nsecond-key",
		Status: common.ChannelStatusEnabled,
		Models: models,
		Group:  "default",
		ChannelInfo: ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: 2,
		},
	}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, channel.UpdateAbilities(nil))
	return channel
}

// Disabling one key of a multi-key target leaves the channel serving, so the
// rule stands; losing the last key takes the channel down and releases it. Both
// entry points decide on the channel's resulting status, not on the status asked
// for a single key.
func TestMultiKeyAutoDisableReleasesModelRoutingOverrideOnceChannelStops(t *testing.T) {
	for _, testCase := range []struct {
		name     string
		disable  func(t *testing.T, channelID int, keyIndex int, usingKey string)
		channels [2]int
	}{
		{
			name:     "by key index",
			channels: [2]int{71, 72},
			disable: func(t *testing.T, channelID int, keyIndex int, _ string) {
				t.Helper()
				require.True(t, UpdateChannelStatusByKeyIndex(channelID, keyIndex, common.ChannelStatusAutoDisabled, "upstream failure"))
			},
		},
		{
			name:     "by using key",
			channels: [2]int{73, 74},
			disable: func(t *testing.T, channelID int, _ int, usingKey string) {
				t.Helper()
				require.True(t, UpdateChannelStatus(channelID, usingKey, common.ChannelStatusAutoDisabled, "upstream failure"))
			},
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			db := setupModelRoutingOverrideTestDB(t)
			channel := createMultiKeyRoutingTestChannel(t, db, testCase.channels[0], "cascade-model")
			enableRoutingOverride(t, channel.Id)

			testCase.disable(t, channel.Id, 0, "first-key")
			serving, err := GetChannelById(channel.Id, false)
			require.NoError(t, err)
			require.Equal(t, common.ChannelStatusEnabled, serving.Status)
			channelID, found, err := GetModelRoutingOverrideTarget("cascade-model")
			require.NoError(t, err)
			require.True(t, found, "one failed key must not release a channel that still serves")
			assert.Equal(t, channel.Id, channelID)

			testCase.disable(t, channel.Id, 1, "second-key")
			stopped, err := GetChannelById(channel.Id, false)
			require.NoError(t, err)
			require.Equal(t, common.ChannelStatusAutoDisabled, stopped.Status)
			_, found, err = GetModelRoutingOverrideTarget("cascade-model")
			require.NoError(t, err)
			assert.False(t, found)
		})
	}
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

func TestMigrateLegacyModelRoutingOverridesPreservesChannelScopedRules(t *testing.T) {
	db := setupModelRoutingOverrideTestDB(t)
	legacyChannel := createRoutingTestChannel(t, db, 69, "legacy-model", "default")
	activeChannel := createRoutingTestChannel(t, db, 70, "active-model", "default")
	enableRoutingOverride(t, activeChannel.Id)
	require.NoError(t, db.Create(&ModelRoutingOverride{
		Model:     "legacy-model",
		Group:     "default",
		ChannelId: legacyChannel.Id,
	}).Error)

	require.NoError(t, migrateLegacyModelRoutingOverrides())
	overrides, err := GetAllModelRoutingOverrides()
	require.NoError(t, err)
	require.Len(t, overrides, 2)
	assert.Equal(t, activeChannel.Id, overrides[0].ChannelId)
	assert.Equal(t, legacyChannel.Id, overrides[1].ChannelId)
}
