package controller

import (
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
