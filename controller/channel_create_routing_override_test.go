package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type channelCreationRoutingResponse struct {
	Success   bool                                 `json:"success"`
	Message   string                               `json:"message"`
	Conflicts []model.ModelRoutingOverrideConflict `json:"conflicts"`
}

func submitChannelCreationForRoutingTest(t *testing.T, request AddChannelRequest) channelCreationRoutingResponse {
	t.Helper()
	body, err := common.Marshal(request)
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("id", 1)
	ctx.Set("role", common.RoleRootUser)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/channel/", bytes.NewReader(body))
	ctx.Request.Header.Set("Content-Type", "application/json")
	AddChannel(ctx)
	require.Equal(t, http.StatusOK, recorder.Code)
	var response channelCreationRoutingResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	return response
}

func TestAddChannelTemporaryRoutingOptions(t *testing.T) {
	tests := []struct {
		name          string
		mode          string
		enable        bool
		status        int
		splitByVendor bool
		wantSuccess   bool
		wantChannels  int
		wantOverrides int
	}{
		{name: "ordinary single", mode: "single", wantSuccess: true, wantChannels: 1},
		{name: "ordinary batch", mode: "batch", wantSuccess: true, wantChannels: 2},
		{name: "temporary single with default status", mode: "single", enable: true, wantSuccess: true, wantChannels: 1, wantOverrides: 2},
		{name: "temporary multi key", mode: "multi_to_single", enable: true, status: common.ChannelStatusEnabled, wantSuccess: true, wantChannels: 1, wantOverrides: 2},
		{name: "disabled channel", mode: "single", enable: true, status: common.ChannelStatusManuallyDisabled},
		{name: "temporary batch rejected", mode: "batch", enable: true},
		{name: "temporary vendor split rejected", mode: "single", enable: true, splitByVendor: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := setupModelListControllerTestDB(t)
			require.NoError(t, db.AutoMigrate(&model.ModelRoutingOverride{}))
			originalMemoryCacheEnabled := common.MemoryCacheEnabled
			common.MemoryCacheEnabled = false
			t.Cleanup(func() { common.MemoryCacheEnabled = originalMemoryCacheEnabled })

			response := submitChannelCreationForRoutingTest(t, AddChannelRequest{
				Mode:                  tt.mode,
				EnableRoutingOverride: tt.enable,
				SplitByModelVendor:    tt.splitByVendor,
				Channel: &model.Channel{
					Name: "created channel", Type: constant.ChannelTypeOpenAI,
					Key: "test-key-a\ntest-key-b", Status: tt.status,
					Models: "model-a", Group: "default,pro",
				},
			})
			assert.Equal(t, tt.wantSuccess, response.Success, response.Message)
			var channels []model.Channel
			require.NoError(t, db.Find(&channels).Error)
			assert.Len(t, channels, tt.wantChannels)
			var abilities []model.Ability
			require.NoError(t, db.Find(&abilities).Error)
			assert.Len(t, abilities, tt.wantChannels*2)
			overrides, err := model.GetAllModelRoutingOverrides()
			require.NoError(t, err)
			assert.Len(t, overrides, tt.wantOverrides)
			if tt.wantOverrides > 0 {
				require.Len(t, channels, 1)
				for _, override := range overrides {
					assert.Equal(t, channels[0].Id, override.ChannelId)
					assert.Equal(t, "model-a", override.Model)
				}
				assert.Equal(t, tt.mode == "multi_to_single", channels[0].ChannelInfo.IsMultiKey)
			}
		})
	}
}

func TestAddChannelTemporaryRoutingConflictsRollbackUntilConfirmed(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.ModelRoutingOverride{}))
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() { common.MemoryCacheEnabled = originalMemoryCacheEnabled })

	existing := model.Channel{
		Name: "existing target", Type: constant.ChannelTypeOpenAI,
		Key: "test-key", Status: common.ChannelStatusEnabled,
		Models: "shared-model,old-only-model", Group: "default",
	}
	require.NoError(t, db.Create(&existing).Error)
	require.NoError(t, existing.AddAbilities(db))
	result, err := model.SetChannelModelRoutingOverride(existing.Id, false)
	require.NoError(t, err)
	require.True(t, result.Applied)

	request := AddChannelRequest{
		Mode: "single", EnableRoutingOverride: true,
		Channel: &model.Channel{
			Name: "replacement target", Type: constant.ChannelTypeOpenAI,
			Key: "test-key-new", Models: "shared-model,new-only-model", Group: "pro",
		},
	}
	response := submitChannelCreationForRoutingTest(t, request)
	assert.False(t, response.Success)
	assert.Equal(t, []model.ModelRoutingOverrideConflict{{
		ChannelId: existing.Id, ChannelName: existing.Name, Models: []string{"shared-model"},
	}}, response.Conflicts)
	var channels []model.Channel
	require.NoError(t, db.Find(&channels).Error)
	assert.Len(t, channels, 1)
	var abilities []model.Ability
	require.NoError(t, db.Find(&abilities).Error)
	assert.Len(t, abilities, 2)
	overrides, err := model.GetAllModelRoutingOverrides()
	require.NoError(t, err)
	assert.Equal(t, result.Overrides, overrides)

	request.ReplaceConflicts = true
	response = submitChannelCreationForRoutingTest(t, request)
	require.True(t, response.Success, response.Message)
	channels = nil
	require.NoError(t, db.Find(&channels).Error)
	require.Len(t, channels, 2)
	var created model.Channel
	require.NoError(t, db.Where("name = ?", "replacement target").First(&created).Error)
	targetID, found, err := model.GetModelRoutingOverrideTarget("shared-model")
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, created.Id, targetID)
	_, found, err = model.GetModelRoutingOverrideTarget("old-only-model")
	require.NoError(t, err)
	assert.False(t, found)
	overrides, err = model.GetAllModelRoutingOverrides()
	require.NoError(t, err)
	require.Len(t, overrides, 2)
	for _, override := range overrides {
		assert.Equal(t, created.Id, override.ChannelId)
		assert.Equal(t, "pro", override.Group)
	}
	var original model.Channel
	require.NoError(t, db.First(&original, existing.Id).Error)
	assert.Equal(t, common.ChannelStatusEnabled, original.Status)
}

func TestAddChannelTemporaryRoutingRequiresRoutingPermission(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Set("id", 7)
	ctx.Set("role", common.RoleCommonUser)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/channel/", bytes.NewBufferString(
		`{"mode":"single","enable_routing_override":true,"channel":{"name":"blocked","type":1,"key":"test-key","models":"model-a","group":"default"}}`,
	))
	ctx.Request.Header.Set("Content-Type", "application/json")
	AddChannel(ctx)
	var response channelCreationRoutingResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
	var channels []model.Channel
	require.NoError(t, db.Find(&channels).Error)
	assert.Empty(t, channels)
}
