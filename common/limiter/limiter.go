package limiter

import (
	"context"
	_ "embed"
	"fmt"
	"sync"

	"github.com/go-redis/redis/v8"
)

//go:embed lua/rate_limit.lua
var rateLimitScript string

type RedisLimiter struct {
	client *redis.Client
	script *redis.Script
}

var (
	instance *RedisLimiter
	once     sync.Once
)

func New(ctx context.Context, r *redis.Client) *RedisLimiter {
	once.Do(func() {
		instance = &RedisLimiter{
			client: r,
			// redis.Script 本地保存脚本及其 SHA1，无需启动时 ScriptLoad：
			// Run 优先 EVALSHA，脚本丢失（NOSCRIPT，如 Redis 重启或 SCRIPT FLUSH）
			// 时自动回退 EVAL 重新载入，不会出现预加载失败后 SHA 永久为空的问题。
			script: redis.NewScript(rateLimitScript),
		}
	})

	return instance
}

func (rl *RedisLimiter) Allow(ctx context.Context, key string, opts ...Option) (bool, error) {
	// 默认配置
	config := &Config{
		Capacity:  10,
		Rate:      1,
		Requested: 1,
	}

	// 应用选项模式
	for _, opt := range opts {
		opt(config)
	}

	// 执行限流
	result, err := rl.script.Run(
		ctx,
		rl.client,
		[]string{key},
		config.Requested,
		config.Rate,
		config.Capacity,
	).Int()

	if err != nil {
		return false, fmt.Errorf("rate limit failed: %w", err)
	}
	return result == 1, nil
}

// Config 配置选项模式
type Config struct {
	Capacity  int64
	Rate      int64
	Requested int64
}

type Option func(*Config)

func WithCapacity(c int64) Option {
	return func(cfg *Config) { cfg.Capacity = c }
}

func WithRate(r int64) Option {
	return func(cfg *Config) { cfg.Rate = r }
}

func WithRequested(n int64) Option {
	return func(cfg *Config) { cfg.Requested = n }
}
