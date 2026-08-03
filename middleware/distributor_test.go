package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
