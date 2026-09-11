package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Check must be read-only: it reports whether a request would be allowed
// without consuming any budget (mirrors the Redis LLen+LIndex pre-check).
func TestInMemoryRateLimiterCheckDoesNotConsumeBudget(t *testing.T) {
	var l InMemoryRateLimiter
	l.Init(0)

	key := "check-readonly"
	// Repeated checks on an empty key must allow and must not record anything.
	require.True(t, l.Check(key, 1, 3600))
	require.True(t, l.Check(key, 1, 3600))

	// The first real request still gets the full budget: if Check had recorded,
	// this Request (maxRequestNum=1) would already be rejected.
	require.True(t, l.Request(key, 1, 3600))
	assert.False(t, l.Check(key, 1, 3600))
	assert.False(t, l.Check(key, 1, 3600))
	assert.False(t, l.Request(key, 1, 3600))
}

// Check on a never-initialized limiter must not panic and fails open.
func TestInMemoryRateLimiterCheckUninitialized(t *testing.T) {
	var l InMemoryRateLimiter
	assert.True(t, l.Check("missing", 1, 60))
}

// maxRequestNum <= 0 means unlimited, matching checkRedisRateLimit semantics.
func TestInMemoryRateLimiterCheckZeroMaxMeansUnlimited(t *testing.T) {
	var l InMemoryRateLimiter
	l.Init(0)

	key := "check-zero-max"
	require.True(t, l.Request(key, 10, 3600))
	assert.True(t, l.Check(key, 0, 3600))
	assert.True(t, l.Check(key, -1, 3600))
}

// Check honors the same sliding-window rule as Request: once the oldest entry
// falls outside the window, the budget is available again. duration=0 makes the
// window always expired, so no sleeping is needed.
func TestInMemoryRateLimiterCheckWindowExpiry(t *testing.T) {
	var l InMemoryRateLimiter
	l.Init(0)

	key := "check-window"
	require.True(t, l.Request(key, 1, 0))
	assert.True(t, l.Check(key, 1, 0))

	fullKey := "check-window-full"
	require.True(t, l.Request(fullKey, 1, 3600))
	assert.False(t, l.Check(fullKey, 1, 3600))
}
