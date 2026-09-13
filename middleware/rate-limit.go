package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/gin-gonic/gin"
	"github.com/go-redis/redis/v8"
)

var timeFormat = "2006-01-02T15:04:05.000Z"

var inMemoryRateLimiter common.InMemoryRateLimiter

var defNext = func(c *gin.Context) {
	c.Next()
}

// windowRateLimitScript 以原子方式完成固定窗口计数限流的「检查 + 记录」，
// 替代原先 LLen/LIndex 检查与 LPush/LTrim 记录跨多次往返的非原子实现，
// 消除并发突刺超限，以及 LLen 之后 key 过期导致 LIndex 读空、解析失败返回 500 的问题。
// 列表元素为 Unix 秒时间戳；窗口数据缺失或异常（如部署前的旧格式数据）按窗口已过期处理（放行）。
// 返回值：-1 放行（已记录）；拒绝时返回窗口剩余秒数，供 429 响应携带 Retry-After。
var windowRateLimitScript = redis.NewScript(`
local key = KEYS[1]
local maxRequestNum = tonumber(ARGV[1])
local duration = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local expiration = tonumber(ARGV[4])

local function record()
    redis.call('LPUSH', key, now)
    redis.call('LTRIM', key, 0, maxRequestNum - 1)
    redis.call('EXPIRE', key, expiration)
    return -1
end

if redis.call('LLEN', key) < maxRequestNum then
    return record()
end

local oldest = tonumber(redis.call('LINDEX', key, -1))
if not oldest then
    return record()
end
if now - oldest < duration then
    redis.call('EXPIRE', key, expiration)
    return duration - (now - oldest)
end
return record()
`)

// windowRedisRateLimit 以固定窗口语义（duration 秒内最多 maxRequestNum 次）对 key 限流，
// 检查与记录在同一 Lua 脚本中原子完成。
func windowRedisRateLimit(c *gin.Context, maxRequestNum int, duration int64, key string) {
	retryAfterSeconds, err := windowRateLimitScript.Run(
		context.Background(),
		common.RDB,
		[]string{key},
		maxRequestNum,
		duration,
		time.Now().Unix(),
		int64(common.RateLimitKeyExpirationDuration/time.Second),
	).Int64()
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("rate limit check failed (key=%s): %v", key, err))
		c.Status(http.StatusInternalServerError)
		c.Abort()
		return
	}
	if retryAfterSeconds >= 0 {
		writeRateLimited(c, retryAfterSeconds)
		return
	}
}

// writeRateLimited rejects the request with 429 and a Retry-After hint so
// clients can back off instead of treating the rejection as a fatal error.
// The in-memory limiter cannot report the remaining window, so callers
// without a TTL pass the full window duration as a conservative upper bound.
func writeRateLimited(c *gin.Context, retryAfterSeconds int64) {
	if retryAfterSeconds > 0 {
		c.Header("Retry-After", strconv.FormatInt(retryAfterSeconds, 10))
	}
	c.Status(http.StatusTooManyRequests)
	c.Abort()
}

func redisRateLimiter(c *gin.Context, maxRequestNum int, duration int64, mark string) {
	key := "rateLimit:" + mark + c.ClientIP()
	windowRedisRateLimit(c, maxRequestNum, duration, key)
}

func memoryRateLimiter(c *gin.Context, maxRequestNum int, duration int64, mark string) {
	key := mark + c.ClientIP()
	if !inMemoryRateLimiter.Request(key, maxRequestNum, duration) {
		writeRateLimited(c, duration)
		return
	}
}

func rateLimitFactory(maxRequestNum int, duration int64, mark string) func(c *gin.Context) {
	if common.RedisEnabled {
		return func(c *gin.Context) {
			redisRateLimiter(c, maxRequestNum, duration, mark)
		}
	} else {
		// It's safe to call multi times.
		inMemoryRateLimiter.Init(common.RateLimitKeyExpirationDuration)
		return func(c *gin.Context) {
			memoryRateLimiter(c, maxRequestNum, duration, mark)
		}
	}
}

func GlobalWebRateLimit() func(c *gin.Context) {
	if common.GlobalWebRateLimitEnable {
		return rateLimitFactory(common.GlobalWebRateLimitNum, common.GlobalWebRateLimitDuration, "GW")
	}
	return defNext
}

func GlobalAPIRateLimit() func(c *gin.Context) {
	if common.GlobalApiRateLimitEnable {
		return rateLimitFactory(common.GlobalApiRateLimitNum, common.GlobalApiRateLimitDuration, "GA")
	}
	return defNext
}

func CriticalRateLimit() func(c *gin.Context) {
	if common.CriticalRateLimitEnable {
		return rateLimitFactory(common.CriticalRateLimitNum, common.CriticalRateLimitDuration, "CT")
	}
	return defNext
}

// UserCriticalRateLimit 在全局 CriticalRateLimit 之外再按认证用户 ID 限流，
// 用于 access token 生成、 AFF 转账这类按账号滥用的敏感路由。
// 必须挂在 UserAuth 之后。
func UserCriticalRateLimit(scope string) func(c *gin.Context) {
	if !common.CriticalRateLimitEnable {
		return defNext
	}
	return userRateLimitFactory(
		common.CriticalRateLimitNum,
		common.CriticalRateLimitDuration,
		"UC:"+scope,
	)
}

func DownloadRateLimit() func(c *gin.Context) {
	return rateLimitFactory(common.DownloadRateLimitNum, common.DownloadRateLimitDuration, "DW")
}

func UploadRateLimit() func(c *gin.Context) {
	return rateLimitFactory(common.UploadRateLimitNum, common.UploadRateLimitDuration, "UP")
}

// userRateLimitFactory creates a rate limiter keyed by authenticated user ID
// instead of client IP, making it resistant to proxy rotation attacks.
// Must be used AFTER authentication middleware (UserAuth).
func userRateLimitFactory(maxRequestNum int, duration int64, mark string) func(c *gin.Context) {
	if common.RedisEnabled {
		return func(c *gin.Context) {
			userId := c.GetInt("id")
			if userId == 0 {
				c.Status(http.StatusUnauthorized)
				c.Abort()
				return
			}
			key := fmt.Sprintf("rateLimit:%s:user:%d", mark, userId)
			userRedisRateLimiter(c, maxRequestNum, duration, key)
		}
	}
	// It's safe to call multi times.
	inMemoryRateLimiter.Init(common.RateLimitKeyExpirationDuration)
	return func(c *gin.Context) {
		userId := c.GetInt("id")
		if userId == 0 {
			c.Status(http.StatusUnauthorized)
			c.Abort()
			return
		}
		key := fmt.Sprintf("%s:user:%d", mark, userId)
		if !inMemoryRateLimiter.Request(key, maxRequestNum, duration) {
			writeRateLimited(c, duration)
			return
		}
	}
}

// userRedisRateLimiter is like redisRateLimiter but accepts a pre-built key
// (to support user-ID-based keys).
func userRedisRateLimiter(c *gin.Context, maxRequestNum int, duration int64, key string) {
	windowRedisRateLimit(c, maxRequestNum, duration, key)
}

// SearchRateLimit returns a per-user rate limiter for search endpoints.
// Configurable via SEARCH_RATE_LIMIT_ENABLE / SEARCH_RATE_LIMIT / SEARCH_RATE_LIMIT_DURATION.
func SearchRateLimit() func(c *gin.Context) {
	if !common.SearchRateLimitEnable {
		return defNext
	}
	return userRateLimitFactory(common.SearchRateLimitNum, common.SearchRateLimitDuration, "SR")
}
