package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLogStatsFollowRequestFiltersAndAuthenticatedUser(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}))
	logs := []model.Log{
		{UserId: 1, Username: "old-alice", CreatedAt: 1700000300, Type: model.LogTypeConsume, RequestId: "selected", UpstreamRequestId: "upstream", Quota: 10, PromptTokens: 10, CompletionTokens: 20},
		{UserId: 1, Username: "old-alice", CreatedAt: 1700000301, Type: model.LogTypeError, RequestId: "selected", UpstreamRequestId: "upstream"},
		{UserId: 1, Username: "old-alice", CreatedAt: 1700000302, Type: model.LogTypeError, RequestId: "other", UpstreamRequestId: "upstream"},
		{UserId: 1, Username: "old-alice", CreatedAt: 1700000303, Type: model.LogTypeError, RequestId: "selected", UpstreamRequestId: "other"},
		{UserId: 2, Username: "bob", CreatedAt: 1700000304, Type: model.LogTypeConsume, RequestId: "selected", UpstreamRequestId: "upstream", Quota: 99, PromptTokens: 100, CompletionTokens: 200},
	}
	require.NoError(t, db.Create(&logs).Error)

	for _, self := range []bool{false, true} {
		name := "admin"
		query := "/api/log/stat?username=old-alice"
		if self {
			name = "self"
			query = "/api/log/self/stat?username=bob&channel=999"
		}
		t.Run(name, func(t *testing.T) {
			query += "&start_timestamp=1700000000&end_timestamp=1700000400&request_id=selected&upstream_request_id=upstream&page_size=1"
			ctx, recorder := newAuthenticatedContext(t, http.MethodGet, query, nil, 1)
			ctx.Set("username", "renamed-alice")
			if self {
				GetLogsSelfStat(ctx)
			} else {
				GetLogsStat(ctx)
			}
			var response struct {
				Success bool       `json:"success"`
				Message string     `json:"message"`
				Data    model.Stat `json:"data"`
			}
			require.Equal(t, http.StatusOK, recorder.Code)
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			require.True(t, response.Success, response.Message)
			assert.Equal(t, model.Stat{Quota: 10, TotalTokens: 30, SuccessCount: 1, TotalCount: 2, SuccessRate: 50}, response.Data)
		})
	}
}
