package model

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupPollingChannelTest installs an isolated in-memory database plus channel
// cache and returns the multi-key polling channel stored in it.
func setupPollingChannelTest(t *testing.T, memoryCacheEnabled bool, keys []string) *Channel {
	t.Helper()

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

	// The polling cursor lives in process-global state, so clear it on both ends to
	// keep these tests independent of each other and of the rest of the package.
	clearPollingCursors := func() {
		channelPollingCursors.Range(func(key, _ any) bool {
			channelPollingCursors.Delete(key)
			return true
		})
	}
	clearPollingCursors()
	t.Cleanup(clearPollingCursors)

	require.NoError(t, db.AutoMigrate(&Channel{}, &Ability{}))

	channel := &Channel{
		Id:     91,
		Name:   "multi-key-polling",
		Key:    strings.Join(keys, "\n"),
		Status: common.ChannelStatusEnabled,
		Models: "gpt-5.5",
		Group:  "default",
		ChannelInfo: ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: len(keys),
			MultiKeyMode: constant.MultiKeyModePolling,
		},
	}
	require.NoError(t, db.Create(channel).Error)
	require.NoError(t, channel.UpdateAbilities(nil))
	if memoryCacheEnabled {
		InitChannelCache()
	}
	return channel
}

// TestGetNextEnabledKeyAdvancesCursorForUncachedChannelObject covers the 指定渠道
// and playground channel_id paths: both resolve the channel with GetChannelById,
// so GetNextEnabledKey runs against a per-request object that is not the cached
// one. The polling cursor must still advance, otherwise every request reuses the
// same upstream key.
func TestGetNextEnabledKeyAdvancesCursorForUncachedChannelObject(t *testing.T) {
	keys := []string{"key-a", "key-b", "key-c"}
	setupPollingChannelTest(t, true, keys)

	got := make([]string, 0, len(keys))
	gotIndexes := make([]int, 0, len(keys))
	for range keys {
		// Freshly loaded per iteration, exactly like the specified-channel path.
		uncached, err := GetChannelById(91, true)
		require.NoError(t, err)
		require.NotSame(t, channelsIDM[91], uncached)

		key, index, apiErr := uncached.GetNextEnabledKey()
		require.Nil(t, apiErr)
		got = append(got, key)
		gotIndexes = append(gotIndexes, index)
	}

	assert.Equal(t, []string{"key-a", "key-b", "key-c"}, got)
	assert.Equal(t, []int{0, 1, 2}, gotIndexes)
}

func TestGetNextEnabledKeyAdvancesCursorForCachedChannelObject(t *testing.T) {
	keys := []string{"key-a", "key-b", "key-c"}
	setupPollingChannelTest(t, true, keys)

	got := make([]string, 0, len(keys)+1)
	for i := 0; i < len(keys)+1; i++ {
		cached, err := CacheGetChannel(91)
		require.NoError(t, err)

		key, _, apiErr := cached.GetNextEnabledKey()
		require.Nil(t, apiErr)
		got = append(got, key)
	}

	// Fourth call wraps back to the first key.
	assert.Equal(t, []string{"key-a", "key-b", "key-c", "key-a"}, got)
}

func TestGetNextEnabledKeyPersistsCursorWithoutMemoryCache(t *testing.T) {
	keys := []string{"key-a", "key-b"}
	setupPollingChannelTest(t, false, keys)

	first, err := GetChannelById(91, true)
	require.NoError(t, err)
	key, _, apiErr := first.GetNextEnabledKey()
	require.Nil(t, apiErr)
	assert.Equal(t, "key-a", key)

	// The cursor is persisted to the database, so a fresh load continues from it.
	stored, err := GetChannelById(91, true)
	require.NoError(t, err)
	assert.Equal(t, 1, stored.ChannelInfo.MultiKeyPollingIndex)

	key, _, apiErr = stored.GetNextEnabledKey()
	require.Nil(t, apiErr)
	assert.Equal(t, "key-b", key)
}

// TestGetNextEnabledKeyConcurrentWithCacheSyncIsRaceFree pins the lock order
// between the polling cursor and the channel cache rebuild: InitChannelCache
// carries the cursor over to the new channel object while requests advance it.
// Both sides must hold the per-channel polling lock, and channelSyncLock must
// always be taken before it, otherwise this deadlocks. Run with -race to see
// the unsynchronized cursor access this guards against.
func TestGetNextEnabledKeyConcurrentWithCacheSyncIsRaceFree(t *testing.T) {
	keys := []string{"key-a", "key-b", "key-c"}
	setupPollingChannelTest(t, true, keys)

	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 25; j++ {
				cached, err := CacheGetChannel(91)
				if err != nil {
					continue
				}
				if _, _, apiErr := cached.GetNextEnabledKey(); apiErr != nil {
					t.Errorf("GetNextEnabledKey failed: %v", apiErr)
					return
				}
			}
		}()
	}

	wg.Add(1)
	go func() {
		defer wg.Done()
		for j := 0; j < 25; j++ {
			InitChannelCache()
		}
	}()

	wg.Wait()

	// The cursor survived the rebuilds and still points at a valid key.
	cursor, ok := channelPollingCursors.Load(91)
	require.True(t, ok)
	assert.GreaterOrEqual(t, cursor.(int), 0)
	assert.Less(t, cursor.(int), len(keys))
}

// TestGetNextEnabledKeyKeepsCursorAcrossCacheSync pins the behaviour that
// InitChannelCache used to hand-carry between channel objects: a cache rebuild
// must not reset multi-key rotation back to the first key.
func TestGetNextEnabledKeyKeepsCursorAcrossCacheSync(t *testing.T) {
	keys := []string{"key-a", "key-b", "key-c"}
	setupPollingChannelTest(t, true, keys)

	cached, err := CacheGetChannel(91)
	require.NoError(t, err)
	key, _, apiErr := cached.GetNextEnabledKey()
	require.Nil(t, apiErr)
	assert.Equal(t, "key-a", key)

	InitChannelCache()

	cached, err = CacheGetChannel(91)
	require.NoError(t, err)
	key, _, apiErr = cached.GetNextEnabledKey()
	require.Nil(t, apiErr)
	assert.Equal(t, "key-b", key, "cache rebuild must not reset the polling cursor")
}

// TestInitChannelCacheUnderPollingLockDoesNotDeadlock pins the lock order that
// controller.multi_key_manage relies on: it holds a channel's polling lock for
// the whole request and calls InitChannelCache inside it (disable_key,
// enable_key, delete_key, ...). InitChannelCache must therefore never acquire a
// polling lock, since sync.Mutex is not reentrant. Guarding the cursor there
// instead of keeping it in channelPollingCursors would hang every one of those
// admin actions.
func TestInitChannelCacheUnderPollingLockDoesNotDeadlock(t *testing.T) {
	keys := []string{"key-a", "key-b", "key-c"}
	setupPollingChannelTest(t, true, keys)

	lock := GetChannelPollingLock(91)
	lock.Lock()
	defer lock.Unlock()

	done := make(chan struct{})
	go func() {
		InitChannelCache()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("InitChannelCache blocked while a channel polling lock was held")
	}
}

// TestGetNextEnabledKeySkipsDisabledKeysForUncachedChannelObject pins the
// interaction between a disabled key and the shared cursor on the same
// uncached-object path.
func TestGetNextEnabledKeySkipsDisabledKeysForUncachedChannelObject(t *testing.T) {
	keys := []string{"key-a", "key-b", "key-c"}
	setupPollingChannelTest(t, true, keys)

	require.True(t, UpdateChannelStatusByKeyIndex(91, 1, common.ChannelStatusAutoDisabled, "test"))

	got := make([]string, 0, 3)
	for i := 0; i < 3; i++ {
		uncached, err := GetChannelById(91, true)
		require.NoError(t, err)

		key, _, apiErr := uncached.GetNextEnabledKey()
		require.Nil(t, apiErr)
		got = append(got, key)
	}

	assert.Equal(t, []string{"key-a", "key-c", "key-a"}, got)
}
