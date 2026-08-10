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

func testChannelBaseURL(value string) *string {
	return &value
}

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

func TestChannelCategoryFiltersApplyBeforePagination(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	channels := []model.Channel{
		{Id: 1, Type: 1, Key: "welfare", Status: common.ChannelStatusEnabled, Name: "公益-站点", Models: "gpt-4o", Group: "default", BaseURL: testChannelBaseURL("https://example.com")},
		{Id: 2, Type: 1, Key: "third-party", Status: common.ChannelStatusEnabled, Name: "三方-共享 Key", Models: "gpt-4o", Group: "default", BaseURL: testChannelBaseURL("https://api.openai.com")},
		{Id: 3, Type: 1, Key: "temporary", Status: common.ChannelStatusEnabled, Name: "临时-测试 Key", Models: "gpt-4o", Group: "default", BaseURL: testChannelBaseURL("https://api.openai.com")},
		{Id: 4, Type: 1, Key: "self-hosted", Status: common.ChannelStatusEnabled, Name: "自建服务", Models: "gpt-4o", Group: "default", BaseURL: testChannelBaseURL("http://host.docker.internal:3000")},
		{Id: 5, Type: 1, Key: "official", Status: common.ChannelStatusEnabled, Name: "OpenAI", Models: "gpt-4o", Group: "default", BaseURL: testChannelBaseURL("https://api.openai.com")},
	}
	require.NoError(t, db.Create(&channels).Error)

	tests := []struct {
		name       string
		requestURL string
		handler    gin.HandlerFunc
		wantID     int
	}{
		{name: "list self hosted", requestURL: "/api/channel?p=1&page_size=1&category=self_hosted", handler: GetAllChannels, wantID: 4},
		{name: "search welfare", requestURL: "/api/channel/search?keyword=&p=1&page_size=1&category=welfare", handler: SearchChannels, wantID: 1},
		{name: "search official", requestURL: "/api/channel/search?keyword=&p=1&page_size=1&category=official", handler: SearchChannels, wantID: 5},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(recorder)
			ctx.Request = httptest.NewRequest(http.MethodGet, test.requestURL, nil)

			test.handler(ctx)

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
			assert.Equal(t, test.wantID, response.Data.Items[0].Id)
			assert.Equal(t, 1, response.Data.Total)
		})
	}
}
