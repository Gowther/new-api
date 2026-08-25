package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestModelRoutingOverrideAPIListsAndRemovesIndividualChannels(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.ModelRoutingOverride{}))

	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
	})

	channelA := model.Channel{
		Id:     91,
		Name:   "api routing A",
		Key:    "key-a",
		Status: common.ChannelStatusEnabled,
		Models: "api-model-a",
		Group:  "default",
	}
	channelB := model.Channel{
		Id:     92,
		Name:   "api routing B",
		Key:    "key-b",
		Status: common.ChannelStatusEnabled,
		Models: "api-model-b",
		Group:  "default",
	}
	require.NoError(t, db.Create(&channelA).Error)
	require.NoError(t, db.Create(&channelB).Error)
	require.NoError(t, channelA.UpdateAbilities(nil))
	require.NoError(t, channelB.UpdateAbilities(nil))
	_, err := model.SetChannelModelRoutingOverride(channelA.Id)
	require.NoError(t, err)
	_, err = model.SetChannelModelRoutingOverride(channelB.Id)
	require.NoError(t, err)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodGet, "/api/channel/model_routing_override", nil)
	GetModelRoutingOverride(ctx)

	assert.Equal(t, http.StatusOK, recorder.Code)
	var listResponse struct {
		Success bool                           `json:"success"`
		Data    []modelRoutingOverrideResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &listResponse))
	assert.True(t, listResponse.Success)
	require.Len(t, listResponse.Data, 2)
	assert.Equal(t, channelA.Id, listResponse.Data[0].ChannelId)
	assert.Equal(t, channelB.Id, listResponse.Data[1].ChannelId)

	recorder = httptest.NewRecorder()
	ctx, _ = gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodDelete,
		"/api/channel/model_routing_override?channel_id=91",
		nil,
	)
	DeleteModelRoutingOverride(ctx)

	assert.Equal(t, http.StatusOK, recorder.Code)
	listResponse = struct {
		Success bool                           `json:"success"`
		Data    []modelRoutingOverrideResponse `json:"data"`
	}{}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &listResponse))
	assert.True(t, listResponse.Success)
	require.Len(t, listResponse.Data, 1)
	assert.Equal(t, channelB.Id, listResponse.Data[0].ChannelId)
}
