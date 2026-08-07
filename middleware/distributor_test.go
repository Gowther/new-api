package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestGetModelFromJSONBodyParsesPlaygroundChannelID(t *testing.T) {
	gin.SetMode(gin.TestMode)

	request := httptest.NewRequest(http.MethodPost, "/pg/chat/completions", strings.NewReader(`{"model":"gpt-4o","group":"default","channel_id":42}`))
	request.Header.Set("Content-Type", "application/json")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = request

	modelRequest, err := getModelFromJSONBody(context)

	require.NoError(t, err)
	require.Equal(t, "gpt-4o", modelRequest.Model)
	require.Equal(t, "default", modelRequest.Group)
	require.NotNil(t, modelRequest.ChannelId)
	require.Equal(t, 42, *modelRequest.ChannelId)
}

func TestGetModelFromJSONBodyRejectsInvalidPlaygroundChannelID(t *testing.T) {
	gin.SetMode(gin.TestMode)

	request := httptest.NewRequest(http.MethodPost, "/pg/chat/completions", strings.NewReader(`{"model":"gpt-4o","channel_id":"42"}`))
	request.Header.Set("Content-Type", "application/json")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = request

	_, err := getModelFromJSONBody(context)

	require.Error(t, err)
	require.ErrorContains(t, err, "channel_id must be a positive integer")
}

func TestChannelSupportsPlaygroundPath(t *testing.T) {
	settings, err := common.Marshal(dto.ChannelOtherSettings{
		AdvancedCustom: &dto.AdvancedCustomConfig{Routes: []dto.AdvancedCustomRoute{{IncomingPath: "/v1/chat/completions"}}},
	})
	require.NoError(t, err)
	channel := &model.Channel{
		Type:          constant.ChannelTypeAdvancedCustom,
		OtherSettings: string(settings),
	}

	require.True(t, channelSupportsRequestPath(channel, "/pg/chat/completions"))
	require.False(t, channelSupportsRequestPath(channel, "/pg/responses"))
}
