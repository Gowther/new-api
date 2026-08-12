package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCacheGetRandomSatisfiedChannelHonorsTemporaryOverrideWithoutFallback(t *testing.T) {
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	model.InitChannelCache()
	require.NoError(t, model.InitModelRoutingOverrideCache())
	modelName := "override-contract-model"
	groupName := "override-contract-group"
	uncoveredGroupName := "override-contract-uncovered-group"
	t.Cleanup(func() {
		require.NoError(t, model.DB.Where("model = ?", modelName).Delete(&model.ModelRoutingOverride{}).Error)
		require.NoError(t, model.DB.Where("model = ?", modelName).Delete(&model.Ability{}).Error)
		require.NoError(t, model.DB.Where("id IN ?", []int{91001, 91002}).Delete(&model.Channel{}).Error)
		model.InitChannelCache()
		require.NoError(t, model.InitModelRoutingOverrideCache())
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
	})

	channels := []model.Channel{
		{Id: 91001, Name: "locked", Key: "key-locked", Status: common.ChannelStatusEnabled, Models: modelName, Group: groupName, Priority: common.GetPointer(int64(1))},
		{Id: 91002, Name: "ordinary", Key: "key-ordinary", Status: common.ChannelStatusEnabled, Models: modelName, Group: groupName + "," + uncoveredGroupName, Priority: common.GetPointer(int64(100))},
	}
	for i := range channels {
		require.NoError(t, model.DB.Create(&channels[i]).Error)
		require.NoError(t, channels[i].UpdateAbilities(nil))
	}
	model.InitChannelCache()
	overrides, err := model.SetModelRoutingOverride(modelName, channels[0].Id)
	require.NoError(t, err)
	require.Len(t, overrides, 1)

	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	selected, selectedGroup, err := CacheGetRandomSatisfiedChannel(&RetryParam{
		Ctx:        ctx,
		TokenGroup: groupName,
		ModelName:  modelName,
		Retry:      common.GetPointer(0),
	})
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, channels[0].Id, selected.Id)
	assert.Equal(t, groupName, selectedGroup)
	assert.True(t, common.GetContextKeyBool(ctx, constant.ContextKeyModelRoutingOverride))

	ctx, _ = gin.CreateTestContext(httptest.NewRecorder())
	selected, _, err = CacheGetRandomSatisfiedChannel(&RetryParam{
		Ctx:        ctx,
		TokenGroup: uncoveredGroupName,
		ModelName:  modelName,
		Retry:      common.GetPointer(0),
	})
	require.NoError(t, err)
	assert.Nil(t, selected, "a model-wide override must not fall back in a group unsupported by its target")

	require.NoError(t, model.DB.Model(&model.Channel{}).Where("id = ?", channels[0].Id).Update("status", common.ChannelStatusManuallyDisabled).Error)
	require.NoError(t, model.UpdateAbilityStatus(channels[0].Id, false))
	model.InitChannelCache()
	ctx, _ = gin.CreateTestContext(httptest.NewRecorder())
	selected, _, err = CacheGetRandomSatisfiedChannel(&RetryParam{
		Ctx:        ctx,
		TokenGroup: groupName,
		ModelName:  modelName,
		Retry:      common.GetPointer(0),
	})
	require.NoError(t, err)
	assert.Nil(t, selected, "a disabled override target must not fall back to another channel")

	_, err = model.DeleteModelRoutingOverride(modelName)
	require.NoError(t, err)
	ctx, _ = gin.CreateTestContext(httptest.NewRecorder())
	selected, _, err = CacheGetRandomSatisfiedChannel(&RetryParam{
		Ctx:        ctx,
		TokenGroup: groupName,
		ModelName:  modelName,
		Retry:      common.GetPointer(0),
	})
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, channels[1].Id, selected.Id, "restoring normal routing must reactivate the existing priority order")
}

func TestCacheGetRandomSatisfiedChannelSkipsEarlierAutoGroupsWhenOverrideExists(t *testing.T) {
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	model.InitChannelCache()
	require.NoError(t, model.InitModelRoutingOverrideCache())
	originalAutoGroups := setting.AutoGroups2JsonString()
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["default","vip"]`))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"default","vip":"vip"}`))

	modelName := "override-auto-group-contract-model"
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(originalAutoGroups))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		require.NoError(t, model.DB.Where("model = ?", modelName).Delete(&model.ModelRoutingOverride{}).Error)
		require.NoError(t, model.DB.Where("model = ?", modelName).Delete(&model.Ability{}).Error)
		require.NoError(t, model.DB.Where("id IN ?", []int{91011, 91012}).Delete(&model.Channel{}).Error)
		model.InitChannelCache()
		require.NoError(t, model.InitModelRoutingOverrideCache())
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
	})

	channels := []model.Channel{
		{Id: 91011, Name: "earlier ordinary", Key: "key-earlier", Status: common.ChannelStatusEnabled, Models: modelName, Group: "default", Priority: common.GetPointer(int64(100))},
		{Id: 91012, Name: "locked later", Key: "key-locked-later", Status: common.ChannelStatusEnabled, Models: modelName, Group: "vip", Priority: common.GetPointer(int64(1))},
	}
	for i := range channels {
		require.NoError(t, model.DB.Create(&channels[i]).Error)
		require.NoError(t, channels[i].UpdateAbilities(nil))
	}
	model.InitChannelCache()
	overrides, err := model.SetModelRoutingOverride(modelName, channels[1].Id)
	require.NoError(t, err)
	require.Len(t, overrides, 1)

	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	selected, selectedGroup, err := CacheGetRandomSatisfiedChannel(&RetryParam{
		Ctx:        ctx,
		TokenGroup: "auto",
		ModelName:  modelName,
		Retry:      common.GetPointer(0),
	})
	require.NoError(t, err)
	require.NotNil(t, selected)
	assert.Equal(t, channels[1].Id, selected.Id)
	assert.Equal(t, "vip", selectedGroup)

	require.NoError(t, model.DB.Model(&model.Channel{}).Where("id = ?", channels[1].Id).Update("status", common.ChannelStatusManuallyDisabled).Error)
	require.NoError(t, model.UpdateAbilityStatus(channels[1].Id, false))
	model.InitChannelCache()
	ctx, _ = gin.CreateTestContext(httptest.NewRecorder())
	selected, _, err = CacheGetRandomSatisfiedChannel(&RetryParam{
		Ctx:        ctx,
		TokenGroup: "auto",
		ModelName:  modelName,
		Retry:      common.GetPointer(0),
	})
	require.NoError(t, err)
	assert.Nil(t, selected, "an unavailable override target must not fall back to an earlier auto group")
}
