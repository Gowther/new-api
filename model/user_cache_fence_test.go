package model

import (
	"context"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func fenceTestUser(id int, quota int) User {
	return User{
		Id:       id,
		Username: "fence-user",
		Group:    "default",
		Quota:    quota,
		Status:   common.UserStatusEnabled,
		Role:     common.RoleCommonUser,
		Password: "test-hash",
	}
}

// 用户缓存冷初始化绝不覆盖活哈希：预扣先改 Redis，之后的快照只刷新 TTL。
func TestPopulateUserCacheNeverOverwritesLiveHash(t *testing.T) {
	useUserCacheMiniRedis(t)

	user := fenceTestUser(201, 5000)
	result, err := populateUserCache(user)
	require.NoError(t, err)
	require.Equal(t, 1, result)

	// 原子预扣：Quota 5000 -> 4500
	applied, err := cacheApplyUserQuotaDelta(user.Id, -500)
	require.NoError(t, err)
	require.Equal(t, cacheQuotaOK, applied)

	// 模拟在途读者拿着预扣前的数据库快照发布缓存
	stale := user
	stale.Quota = 5000
	result, err = populateUserCache(stale)
	require.NoError(t, err)
	require.Equal(t, 2, result)

	cached, err := cacheGetUserBase(user.Id)
	require.NoError(t, err)
	assert.Equal(t, 4500, cached.Quota, "预扣结果不得被陈旧快照回滚")
}

// 用户 fence 存在期间读者不得发布缓存。
func TestPopulateUserCacheBlockedByFence(t *testing.T) {
	useUserCacheMiniRedis(t)

	user := fenceTestUser(202, 3000)
	require.NoError(t, invalidateUserCache(user.Id))

	result, err := populateUserCache(user)
	require.NoError(t, err)
	require.Equal(t, 0, result)

	_, err = cacheGetUserBase(user.Id)
	require.Error(t, err, "fence 期间缓存必须保持为冷")
}

// 残缺用户哈希被读取路径拒绝。
func TestCacheGetUserBaseRejectsIncompleteHash(t *testing.T) {
	useUserCacheMiniRedis(t)

	_, err := common.RDB.HSet(context.Background(), "user:301", "Quota", "500").Result()
	require.NoError(t, err)

	_, err = cacheGetUserBase(301)
	require.Error(t, err, "残缺哈希必须按缓存未命中处理")
}
