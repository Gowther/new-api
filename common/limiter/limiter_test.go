package limiter

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestRedisLimiter(t *testing.T) (*RedisLimiter, *miniredis.Miniredis) {
	t.Helper()
	server := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	// Construct directly instead of via New(): the singleton's sync.Once would
	// bind instance.client to the first test server for the whole test binary.
	return &RedisLimiter{client: rdb, script: redis.NewScript(rateLimitScript)}, server
}

func TestAllowConsumesTokensUpToCapacity(t *testing.T) {
	rl, _ := newTestRedisLimiter(t)
	ctx := context.Background()

	allowed, err := rl.Allow(ctx, "rateLimit:test-basic", WithCapacity(2), WithRate(1), WithRequested(1))
	require.NoError(t, err)
	assert.True(t, allowed)
	allowed, err = rl.Allow(ctx, "rateLimit:test-basic", WithCapacity(2), WithRate(1), WithRequested(1))
	require.NoError(t, err)
	assert.True(t, allowed)
	allowed, err = rl.Allow(ctx, "rateLimit:test-basic", WithCapacity(2), WithRate(1), WithRequested(1))
	require.NoError(t, err)
	assert.False(t, allowed)
}

// The limiter hash must expire: an idle user's key has to disappear instead of
// accumulating forever. TTL = max(ceil(capacity/rate), 60s) idle window.
func TestAllowSetsIdleExpiration(t *testing.T) {
	rl, server := newTestRedisLimiter(t)
	ctx := context.Background()

	_, err := rl.Allow(ctx, "rateLimit:test-ttl", WithCapacity(2), WithRate(1), WithRequested(1))
	require.NoError(t, err)
	assert.Equal(t, 60*time.Second, server.TTL("rateLimit:test-ttl"))

	_, err = rl.Allow(ctx, "rateLimit:test-ttl-long", WithCapacity(600), WithRate(1), WithRequested(1))
	require.NoError(t, err)
	assert.Equal(t, 600*time.Second, server.TTL("rateLimit:test-ttl-long"))

	// A non-positive rate must not produce an invalid/never-expiring TTL.
	_, err = rl.Allow(ctx, "rateLimit:test-ttl-zerorate", WithCapacity(2), WithRate(0), WithRequested(1))
	require.NoError(t, err)
	assert.Equal(t, 60*time.Second, server.TTL("rateLimit:test-ttl-zerorate"))
}

// A brand-new Redis (or one that lost its script cache via restart/SCRIPT FLUSH)
// answers EVALSHA with NOSCRIPT; Script.Run must transparently retry with EVAL.
func TestAllowRecoversFromNoScript(t *testing.T) {
	rl, _ := newTestRedisLimiter(t)
	ctx := context.Background()

	allowed, err := rl.Allow(ctx, "rateLimit:test-noscript", WithCapacity(1), WithRate(1), WithRequested(1))
	require.NoError(t, err)
	assert.True(t, allowed)

	// Flush the server-side script cache; the next call must still succeed.
	require.NoError(t, rl.client.ScriptFlush(ctx).Err())
	allowed, err = rl.Allow(ctx, "rateLimit:test-noscript-after-flush", WithCapacity(2), WithRate(1), WithRequested(1))
	require.NoError(t, err)
	assert.True(t, allowed)
}
