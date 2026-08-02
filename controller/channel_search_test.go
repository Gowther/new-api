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

func TestSearchChannelsChannelIDReturnsOnlyExactChannel(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	channels := []model.Channel{
		{
			Id:     18,
			Type:   1,
			Key:    "target-key",
			Status: common.ChannelStatusEnabled,
			Name:   "target channel",
			Models: "gpt-4o",
			Group:  "default",
		},
		{
			Id:     19,
			Type:   1,
			Key:    "other-key",
			Status: common.ChannelStatusEnabled,
			Name:   "channel containing 18",
			Models: "gpt-4o",
			Group:  "default",
		},
	}
	require.NoError(t, db.Create(&channels).Error)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodGet,
		"/api/channel/search?keyword=18&channel_id=18&p=1&page_size=20",
		nil,
	)

	SearchChannels(ctx)

	var response struct {
		Success bool `json:"success"`
		Data    struct {
			Items []model.Channel `json:"items"`
			Total int             `json:"total"`
		} `json:"data"`
	}
	require.Equal(t, http.StatusOK, recorder.Code)
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.Len(t, response.Data.Items, 1)
	assert.Equal(t, 18, response.Data.Items[0].Id)
	assert.Equal(t, 1, response.Data.Total)
}
