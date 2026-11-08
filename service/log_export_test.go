package service

import (
	"context"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLogExportLockSerializesEachUser(t *testing.T) {
	oldEnabled, oldClient := common.RedisEnabled, common.RDB
	t.Cleanup(func() { common.RedisEnabled, common.RDB = oldEnabled, oldClient })
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	common.RDB = client
	for _, enabled := range []bool{false, true} {
		common.RedisEnabled = enabled
		release, ok, err := AcquireLogExportLock(context.Background(), 1)
		require.NoError(t, err)
		require.True(t, ok)
		_, ok, err = AcquireLogExportLock(context.Background(), 1)
		require.NoError(t, err)
		assert.False(t, ok)
		other, ok, err := AcquireLogExportLock(context.Background(), 2)
		require.NoError(t, err)
		require.True(t, ok)
		other()
		release()
		release()
		next, ok, err := AcquireLogExportLock(context.Background(), 1)
		require.NoError(t, err)
		require.True(t, ok)
		next()
	}
	// An expired owner's release cannot remove the next export's lease.
	common.RedisEnabled = true
	oldRelease, ok, err := AcquireLogExportLock(context.Background(), 3)
	require.NoError(t, err)
	require.True(t, ok)
	server.FastForward(LogExportTimeout + 2*time.Minute)
	nextRelease, ok, err := AcquireLogExportLock(context.Background(), 3)
	require.NoError(t, err)
	require.True(t, ok)
	oldRelease()
	_, ok, err = AcquireLogExportLock(context.Background(), 3)
	require.NoError(t, err)
	assert.False(t, ok)
	nextRelease()
}
