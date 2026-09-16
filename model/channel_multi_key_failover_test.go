package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestGetNextEnabledKeyFailoverSticksToCursor pins the sticky behaviour: the
// channel keeps serving the same key on every request so upstream cache
// affinity survives, unlike polling which rotates on every call.
func TestGetNextEnabledKeyFailoverSticksToCursor(t *testing.T) {
	keys := []string{"key-a", "key-b", "key-c"}
	setupMultiKeyChannelTest(t, true, constant.MultiKeyModeFailover, keys)

	for i := 0; i < 5; i++ {
		// Freshly loaded per iteration, exactly like the specified-channel path.
		uncached, err := GetChannelById(91, true)
		require.NoError(t, err)
		key, index, apiErr := uncached.GetNextEnabledKey()
		require.Nil(t, apiErr)
		assert.Equal(t, "key-a", key)
		assert.Equal(t, 0, index)
	}
}

// TestGetNextEnabledKeyFailoverMovesAfterDisable pins the failover trigger:
// once the active key is auto-disabled the next request lands on the following
// enabled key and sticks to it, while disabling keys elsewhere leaves it alone.
func TestGetNextEnabledKeyFailoverMovesAfterDisable(t *testing.T) {
	keys := []string{"key-a", "key-b", "key-c"}
	setupMultiKeyChannelTest(t, true, constant.MultiKeyModeFailover, keys)

	first, err := GetChannelById(91, true)
	require.NoError(t, err)
	key, _, apiErr := first.GetNextEnabledKey()
	require.Nil(t, apiErr)
	assert.Equal(t, "key-a", key)

	require.True(t, UpdateChannelStatusByKeyIndex(91, 0, common.ChannelStatusAutoDisabled, "test"))

	uncached, err := GetChannelById(91, true)
	require.NoError(t, err)
	key, index, apiErr := uncached.GetNextEnabledKey()
	require.Nil(t, apiErr)
	assert.Equal(t, "key-b", key)
	assert.Equal(t, 1, index)

	// Disabling a key past the current one must not move the sticky cursor.
	require.True(t, UpdateChannelStatusByKeyIndex(91, 2, common.ChannelStatusAutoDisabled, "test"))
	uncached, err = GetChannelById(91, true)
	require.NoError(t, err)
	key, _, apiErr = uncached.GetNextEnabledKey()
	require.Nil(t, apiErr)
	assert.Equal(t, "key-b", key)
}

// TestGetNextEnabledKeyFailoverDoesNotRevertAfterRecovery pins the no-revert
// rule: a key that recovered (e.g. through the scheduled channel test) returns
// to the candidate pool, but the sticky cursor stays on the key it moved to.
func TestGetNextEnabledKeyFailoverDoesNotRevertAfterRecovery(t *testing.T) {
	keys := []string{"key-a", "key-b", "key-c"}
	setupMultiKeyChannelTest(t, true, constant.MultiKeyModeFailover, keys)

	require.True(t, UpdateChannelStatusByKeyIndex(91, 0, common.ChannelStatusAutoDisabled, "test"))

	uncached, err := GetChannelById(91, true)
	require.NoError(t, err)
	key, index, apiErr := uncached.GetNextEnabledKey()
	require.Nil(t, apiErr)
	assert.Equal(t, "key-b", key)
	assert.Equal(t, 1, index)

	require.True(t, UpdateChannelStatusByKeyIndex(91, 0, common.ChannelStatusEnabled, "test"))

	for i := 0; i < 3; i++ {
		uncached, err = GetChannelById(91, true)
		require.NoError(t, err)
		key, _, apiErr = uncached.GetNextEnabledKey()
		require.Nil(t, apiErr)
		assert.Equal(t, "key-b", key, "recovered key must not pull the sticky cursor back")
	}
}

// TestGetNextEnabledKeyFailoverAllKeysDisabled pins the handoff when every key
// is gone: the caller gets an explicit no-key error so the channel can be
// marked disabled instead of looping on a dead key.
func TestGetNextEnabledKeyFailoverAllKeysDisabled(t *testing.T) {
	keys := []string{"key-a", "key-b"}
	setupMultiKeyChannelTest(t, true, constant.MultiKeyModeFailover, keys)

	require.True(t, UpdateChannelStatusByKeyIndex(91, 0, common.ChannelStatusAutoDisabled, "test"))
	require.True(t, UpdateChannelStatusByKeyIndex(91, 1, common.ChannelStatusAutoDisabled, "test"))

	uncached, err := GetChannelById(91, true)
	require.NoError(t, err)
	_, _, apiErr := uncached.GetNextEnabledKey()
	require.NotNil(t, apiErr)
}

// TestGetNextEnabledKeyFailoverPersistsCursorWithoutMemoryCache covers the
// no-cache path: the sticky cursor is read from and persisted to the database,
// so a failover decision survives a channel re-load.
func TestGetNextEnabledKeyFailoverPersistsCursorWithoutMemoryCache(t *testing.T) {
	keys := []string{"key-a", "key-b", "key-c"}
	setupMultiKeyChannelTest(t, false, constant.MultiKeyModeFailover, keys)

	first, err := GetChannelById(91, true)
	require.NoError(t, err)
	key, _, apiErr := first.GetNextEnabledKey()
	require.Nil(t, apiErr)
	assert.Equal(t, "key-a", key)

	require.True(t, UpdateChannelStatusByKeyIndex(91, 0, common.ChannelStatusAutoDisabled, "test"))

	uncached, err := GetChannelById(91, true)
	require.NoError(t, err)
	key, index, apiErr := uncached.GetNextEnabledKey()
	require.Nil(t, apiErr)
	assert.Equal(t, "key-b", key)
	assert.Equal(t, 1, index)

	stored, err := GetChannelById(91, true)
	require.NoError(t, err)
	assert.Equal(t, 1, stored.ChannelInfo.MultiKeyPollingIndex)
}

// TestSetChannelPollingCursorClampsNegative pins that admin cursor re-anchoring
// stays in the valid range.
func TestSetChannelPollingCursorClampsNegative(t *testing.T) {
	keys := []string{"key-a"}
	setupMultiKeyChannelTest(t, true, constant.MultiKeyModeFailover, keys)

	SetChannelPollingCursor(91, -3)
	cursor, ok := channelPollingCursors.Load(91)
	require.True(t, ok)
	assert.Equal(t, 0, cursor.(int))

	uncached, err := GetChannelById(91, true)
	require.NoError(t, err)
	key, _, apiErr := uncached.GetNextEnabledKey()
	require.Nil(t, apiErr)
	assert.Equal(t, "key-a", key)
}
