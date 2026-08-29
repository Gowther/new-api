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
	resultA, err := model.SetChannelModelRoutingOverride(channelA.Id, false)
	require.NoError(t, err)
	require.True(t, resultA.Applied)
	resultB, err := model.SetChannelModelRoutingOverride(channelB.Id, false)
	require.NoError(t, err)
	require.True(t, resultB.Applied)

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

// The prompt needs the overlapping targets by name before it can offer to
// replace them, and a confirmed replacement has to actually take over.
func TestModelRoutingOverrideAPIReportsConflictsBeforeReplacing(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.ModelRoutingOverride{}))

	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
	})

	channelA := model.Channel{
		Id:     93,
		Name:   "conflict routing A",
		Key:    "key-a",
		Status: common.ChannelStatusEnabled,
		Models: "conflict-model,a-only-model",
		Group:  "default",
	}
	channelB := model.Channel{
		Id:     94,
		Name:   "conflict routing B",
		Key:    "key-b",
		Status: common.ChannelStatusEnabled,
		Models: "conflict-model",
		Group:  "default",
	}
	require.NoError(t, db.Create(&channelA).Error)
	require.NoError(t, db.Create(&channelB).Error)
	require.NoError(t, channelA.UpdateAbilities(nil))
	require.NoError(t, channelB.UpdateAbilities(nil))
	result, err := model.SetChannelModelRoutingOverride(channelA.Id, false)
	require.NoError(t, err)
	require.True(t, result.Applied)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodGet,
		"/api/channel/model_routing_override/conflicts?channel_id=94",
		nil,
	)
	GetModelRoutingOverrideConflicts(ctx)

	assert.Equal(t, http.StatusOK, recorder.Code)
	var preflight struct {
		Success bool                                 `json:"success"`
		Data    []model.ModelRoutingOverrideConflict `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &preflight))
	assert.True(t, preflight.Success)
	require.Len(t, preflight.Data, 1)
	assert.Equal(t, channelA.Id, preflight.Data[0].ChannelId)
	assert.Equal(t, channelA.Name, preflight.Data[0].ChannelName)
	assert.Equal(t, []string{"conflict-model"}, preflight.Data[0].Models)

	// Without confirmation the write is refused and reports the same targets.
	recorder = httptest.NewRecorder()
	ctx, _ = gin.CreateTestContext(recorder)
	ctx.Set("id", 1)
	ctx.Set("role", common.RoleRootUser)
	ctx.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/channel/model_routing_override",
		strings.NewReader(`{"channel_id":94}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")
	SetModelRoutingOverride(ctx)

	assert.Equal(t, http.StatusOK, recorder.Code)
	var blocked struct {
		Success   bool                                 `json:"success"`
		Message   string                               `json:"message"`
		Conflicts []model.ModelRoutingOverrideConflict `json:"conflicts"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &blocked))
	assert.False(t, blocked.Success)
	assert.NotEmpty(t, blocked.Message)
	require.Len(t, blocked.Conflicts, 1)
	assert.Equal(t, channelA.Id, blocked.Conflicts[0].ChannelId)

	channelID, found, err := model.GetModelRoutingOverrideTarget("conflict-model")
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, channelA.Id, channelID)

	// Confirming releases A entirely, including the model B does not serve.
	recorder = httptest.NewRecorder()
	ctx, _ = gin.CreateTestContext(recorder)
	ctx.Set("id", 1)
	ctx.Set("role", common.RoleRootUser)
	ctx.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/channel/model_routing_override",
		strings.NewReader(`{"channel_id":94,"replace_conflicts":true}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")
	SetModelRoutingOverride(ctx)

	assert.Equal(t, http.StatusOK, recorder.Code)
	var replaced struct {
		Success bool                           `json:"success"`
		Data    []modelRoutingOverrideResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &replaced))
	assert.True(t, replaced.Success)
	require.Len(t, replaced.Data, 1)
	assert.Equal(t, channelB.Id, replaced.Data[0].ChannelId)

	channelID, found, err = model.GetModelRoutingOverrideTarget("conflict-model")
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, channelB.Id, channelID)
	_, found, err = model.GetModelRoutingOverrideTarget("a-only-model")
	require.NoError(t, err)
	assert.False(t, found)
}
