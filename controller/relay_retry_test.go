package controller

import (
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestShouldRetryKeepsSpecificChannelPinned(t *testing.T) {
	gin.SetMode(gin.TestMode)
	channelErr := types.NewError(errors.New("channel failed"), types.ErrorCodeChannelInvalidKey)

	automaticContext, _ := gin.CreateTestContext(httptest.NewRecorder())
	require.True(t, shouldRetry(automaticContext, channelErr, 1))

	specificContext, _ := gin.CreateTestContext(httptest.NewRecorder())
	specificContext.Set("specific_channel_id", "11")
	require.False(t, shouldRetry(specificContext, channelErr, 1))
}

func TestShouldRetryKeepsTemporaryRoutingTargetPinned(t *testing.T) {
	gin.SetMode(gin.TestMode)
	channelErr := types.NewError(errors.New("channel failed"), types.ErrorCodeChannelInvalidKey)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyModelRoutingOverride, true)

	require.False(t, shouldRetry(ctx, channelErr, 1))
}

func TestGetChannelSeedsPreviousPriorityFromInitialSelection(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	priority := int64(200)
	channel := &model.Channel{
		Id:       101,
		Name:     "primary",
		Type:     1,
		Key:      "test-key",
		Priority: &priority,
	}
	require.Nil(t, middleware.SetupContextForSelectedChannel(ctx, channel, "gpt-5.5"))

	retryParam := &service.RetryParam{}
	selected, err := getChannel(ctx, &relaycommon.RelayInfo{}, retryParam)
	require.Nil(t, err)
	require.NotNil(t, selected)
	require.NotNil(t, retryParam.PreviousChannelPriority)
	assert.Equal(t, channel.Id, selected.Id)
	assert.Equal(t, priority, selected.GetPriority())
	assert.Equal(t, priority, *retryParam.PreviousChannelPriority)
}

// The AI error briefing calls Relay directly, so nothing preselects a channel
// for it. getChannel must fall through to real selection instead of trusting the
// absent channel_id and handing back a phantom channel 0, which would relay to
// an empty base url with an empty key.
func TestGetChannelSelectsWhenNoChannelPreselected(t *testing.T) {
	originalDB := model.DB
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)

	// The memory cache path keeps selection on plain GORM queries, so this fixture
	// does not need the dialect-specific column names that only InitDB sets up.
	model.DB = db
	common.MemoryCacheEnabled = true
	t.Cleanup(func() {
		model.DB = originalDB
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.ModelRoutingOverride{}))

	const modelName = "error-briefing-model"
	channel := model.Channel{
		Id:     93001,
		Name:   "briefing upstream",
		Key:    "briefing-key",
		Type:   constant.ChannelTypeOpenAI,
		Status: common.ChannelStatusEnabled,
		Models: modelName,
		Group:  "default",
	}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, channel.UpdateAbilities(nil))
	model.InitChannelCache()
	require.NoError(t, model.InitModelRoutingOverrideCache())

	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	retryParam := &service.RetryParam{
		Ctx:         ctx,
		ModelName:   modelName,
		TokenGroup:  "default",
		RequestPath: "/pg/chat/completions",
	}

	selected, apiErr := getChannel(ctx, &relaycommon.RelayInfo{OriginModelName: modelName}, retryParam)

	require.Nil(t, apiErr)
	require.NotNil(t, selected)
	assert.Equal(t, channel.Id, selected.Id)
	assert.Equal(t, "briefing-key", selected.Key)
	assert.Equal(t, channel.Id, ctx.GetInt("channel_id"))
}
