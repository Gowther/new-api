package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestManageMultiKeysManualDisableClearsTemporaryRouting(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.ModelRoutingOverride{}))

	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
	})

	channel := model.Channel{
		Id:     82,
		Name:   "multi-key temporary target",
		Key:    "first-key\nsecond-key",
		Status: common.ChannelStatusEnabled,
		Models: "multi-key-model",
		Group:  "default",
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: 2,
		},
	}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, channel.UpdateAbilities(nil))
	_, err := model.SetChannelModelRoutingOverride(channel.Id)
	require.NoError(t, err)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("id", 1)
	ctx.Set("role", common.RoleRootUser)
	ctx.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/channel/multi_key/manage",
		strings.NewReader(`{"channel_id":82,"action":"disable_key","key_index":0}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")

	ManageMultiKeys(ctx)

	assert.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool `json:"success"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success)

	_, found, err := model.GetModelRoutingOverrideTarget("multi-key-model")
	require.NoError(t, err)
	assert.False(t, found)

	_, err = model.SetChannelModelRoutingOverride(channel.Id)
	require.NoError(t, err)
	recorder = httptest.NewRecorder()
	ctx, _ = gin.CreateTestContext(recorder)
	ctx.Set("id", 1)
	ctx.Set("role", common.RoleRootUser)
	ctx.Request = httptest.NewRequest(
		http.MethodPost,
		"/api/channel/multi_key/manage",
		strings.NewReader(`{"channel_id":82,"action":"disable_all_keys"}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")

	ManageMultiKeys(ctx)

	assert.Equal(t, http.StatusOK, recorder.Code)
	response = struct {
		Success bool `json:"success"`
	}{}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.True(t, response.Success)
	_, found, err = model.GetModelRoutingOverrideTarget("multi-key-model")
	require.NoError(t, err)
	assert.False(t, found)
}
