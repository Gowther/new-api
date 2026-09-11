package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// useRateLimitMiniRedis swaps the global Redis client for an in-process server.
func useRateLimitMiniRedis(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	server := miniredis.RunT(t)
	oldRedisEnabled := common.RedisEnabled
	oldRDB := common.RDB
	common.RedisEnabled = true
	common.RDB = redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() {
		_ = common.RDB.Close()
		common.RedisEnabled = oldRedisEnabled
		common.RDB = oldRDB
	})
	return server
}

func runWindowRateLimit(key string, maxRequestNum int, duration int64) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/limited", nil)
	windowRedisRateLimit(c, maxRequestNum, duration, key)
	// 直接调用中间件时没有 gin 引擎收尾的 WriteHeaderNow，这里手动刷新，
	// 让 c.Status()+Abort() 的状态码落到 recorder 上。
	c.Writer.WriteHeaderNow()
	return recorder
}

func TestWindowRedisRateLimitDeniesBeyondMaxWithinWindow(t *testing.T) {
	useRateLimitMiniRedis(t)
	gin.SetMode(gin.TestMode)

	key := "rateLimit:UT:127.0.0.1"
	require.Equal(t, http.StatusOK, runWindowRateLimit(key, 2, 60).Code)
	require.Equal(t, http.StatusOK, runWindowRateLimit(key, 2, 60).Code)
	// Third request inside the same window is rejected atomically.
	require.Equal(t, http.StatusTooManyRequests, runWindowRateLimit(key, 2, 60).Code)
	require.Equal(t, http.StatusTooManyRequests, runWindowRateLimit(key, 2, 60).Code)
}

func TestWindowRedisRateLimitSetsKeyExpiration(t *testing.T) {
	server := useRateLimitMiniRedis(t)
	gin.SetMode(gin.TestMode)

	key := "rateLimit:UT:ttl"
	require.Equal(t, http.StatusOK, runWindowRateLimit(key, 5, 60).Code)
	assert.Equal(t, common.RateLimitKeyExpirationDuration, server.TTL(key))
}

func TestWindowRedisRateLimitAllowsAfterWindowExpires(t *testing.T) {
	useRateLimitMiniRedis(t)
	gin.SetMode(gin.TestMode)

	key := "rateLimit:UT:expired-window"
	// Seed a full window whose entries are already outside the duration.
	old := strconv.FormatInt(time.Now().Unix()-120, 10)
	ctx := context.Background()
	require.NoError(t, common.RDB.LPush(ctx, key, old).Err())
	require.NoError(t, common.RDB.LPush(ctx, key, old).Err())

	require.Equal(t, http.StatusOK, runWindowRateLimit(key, 2, 60).Code)
	// 窗口内的旧条目不会被删除（与改动前的 LTRIM 行为一致），只按容量裁剪：
	// 新条目入列后列表保留至多 maxRequestNum 条。
	length, err := common.RDB.LLen(ctx, key).Result()
	require.NoError(t, err)
	assert.Equal(t, int64(2), length)
}

// Data written by the pre-migration implementation (formatted time strings) or
// otherwise unreadable window data must fail open instead of returning 500.
func TestWindowRedisRateLimitTreatsLegacyWindowDataAsExpired(t *testing.T) {
	useRateLimitMiniRedis(t)
	gin.SetMode(gin.TestMode)

	key := "rateLimit:UT:legacy"
	ctx := context.Background()
	require.NoError(t, common.RDB.LPush(ctx, key, "2024-01-01T00:00:00.000Z").Err())
	require.NoError(t, common.RDB.LPush(ctx, key, "2024-01-01T00:00:00.000Z").Err())

	require.Equal(t, http.StatusOK, runWindowRateLimit(key, 2, 60).Code)
}

func TestWindowRedisRateLimitErrorsWhenRedisDown(t *testing.T) {
	server := useRateLimitMiniRedis(t)
	gin.SetMode(gin.TestMode)
	server.Close()

	require.Equal(t, http.StatusInternalServerError, runWindowRateLimit("rateLimit:UT:down", 2, 60).Code)
}
