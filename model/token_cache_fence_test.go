package model

import (
	"context"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func fenceTestToken(id int) Token {
	return Token{
		Id: id, UserId: 7, Status: 1, Name: "fence-test",
		CreatedTime: 1700000000, AccessedTime: 1700000000, ExpiredTime: -1,
		RemainQuota: 1000, UsedQuota: 0, Group: "default",
	}
}

// 数据库快照绝不覆盖活哈希：预扣先改 Redis，之后的快照只刷新 TTL。
func TestCacheInitTokenNeverOverwritesLiveHash(t *testing.T) {
	useUserCacheMiniRedis(t)

	token := fenceTestToken(101)
	result, err := cacheInitToken(token)
	require.NoError(t, err)
	require.Equal(t, 1, result)

	// 原子预扣：RemainQuota 1000 -> 900
	applied, err := cacheApplyTokenQuotaDelta(token.Id, token.Key, -100)
	require.NoError(t, err)
	require.Equal(t, cacheQuotaOK, applied)

	// 模拟在途读者拿着预扣前的数据库快照发布缓存
	stale := token
	stale.RemainQuota = 1000
	result, err = cacheInitToken(stale)
	require.NoError(t, err)
	require.Equal(t, 2, result)

	cached, err := cacheGetTokenByKey(token.Key)
	require.NoError(t, err)
	assert.Equal(t, 900, cached.RemainQuota, "预扣结果不得被陈旧快照回滚")
	assert.Equal(t, 100, cached.UsedQuota)
}

// fence 存在期间读者不得发布缓存。
func TestCacheInitTokenBlockedByFence(t *testing.T) {
	useUserCacheMiniRedis(t)

	token := fenceTestToken(102)
	token.Key = "fence-block-key"
	require.NoError(t, invalidateTokenCacheForMutation(token.Key))

	result, err := cacheInitToken(token)
	require.NoError(t, err)
	require.Equal(t, 0, result)

	_, err = cacheGetTokenByKey(token.Key)
	require.Error(t, err, "fence 期间缓存必须保持为冷")
}

// fence 过期后重新水合。
func TestCacheInitTokenHydratesAfterFenceExpiry(t *testing.T) {
	server := useUserCacheMiniRedis(t)

	token := fenceTestToken(103)
	token.Key = "fence-expiry-key"
	require.NoError(t, invalidateTokenCacheForMutation(token.Key))
	server.FastForward(time.Duration(tokenCacheFenceSeconds+1) * time.Second)

	result, err := cacheInitToken(token)
	require.NoError(t, err)
	require.Equal(t, 1, result)

	cached, err := cacheGetTokenByKey(token.Key)
	require.NoError(t, err)
	assert.Equal(t, token.RemainQuota, cached.RemainQuota)
}

// 守卫式增量：哈希缺失时跳过，绝不创建残缺哈希。
func TestTokenQuotaDeltaSkipsColdCache(t *testing.T) {
	useUserCacheMiniRedis(t)

	token := fenceTestToken(104)
	token.Key = "cold-cache-key"
	applied, err := cacheApplyTokenQuotaDelta(token.Id, token.Key, -100)
	require.NoError(t, err)
	require.Equal(t, cacheQuotaMiss, applied)

	exists, err := common.RDB.Exists(context.Background(), getTokenCacheKey(token.Key)).Result()
	require.NoError(t, err)
	assert.Equal(t, int64(0), exists, "缺失哈希不得被增量脚本创建")
}

// 残缺哈希被读取路径拒绝。
func TestCacheGetTokenByKeyRejectsIncompleteHash(t *testing.T) {
	useUserCacheMiniRedis(t)

	token := fenceTestToken(105)
	token.Key = "incomplete-hash-key"
	_, err := common.RDB.HSet(context.Background(), getTokenCacheKey(token.Key), "RemainQuota", "500").Result()
	require.NoError(t, err)

	_, err = cacheGetTokenByKey(token.Key)
	require.Error(t, err, "残缺哈希必须按缓存未命中处理")
}

// 变更失效：先立 fence 再删哈希。
func TestInvalidateTokenCacheForMutation(t *testing.T) {
	useUserCacheMiniRedis(t)

	token := fenceTestToken(106)
	token.Key = "invalidate-key"
	_, err := cacheInitToken(token)
	require.NoError(t, err)

	require.NoError(t, invalidateTokenCacheForMutation(token.Key))

	fenceExists, err := common.RDB.Exists(context.Background(), getTokenCacheFenceKey(token.Key)).Result()
	require.NoError(t, err)
	assert.Equal(t, int64(1), fenceExists)
	hashExists, err := common.RDB.Exists(context.Background(), getTokenCacheKey(token.Key)).Result()
	require.NoError(t, err)
	assert.Equal(t, int64(0), hashExists)
}
