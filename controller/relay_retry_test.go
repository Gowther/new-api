package controller

import (
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
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
