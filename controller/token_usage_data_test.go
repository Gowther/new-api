package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

type tokenUsageAPIResponse struct {
	Success bool                         `json:"success"`
	Message string                       `json:"message"`
	Data    model.TokenUsageSelfResponse `json:"data"`
}

func TestGetTokenUsageSelfUsesAuthenticatedUserID(t *testing.T) {
	db := openTokenControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.TokenUsageData{}))

	base := int64(1700000300)
	require.NoError(t, model.RecordTokenUsageData(1, "alice", model.RecordConsumeLogParams{
		TokenId:          11,
		TokenName:        "alice-main",
		ModelName:        "gpt-test",
		PromptTokens:     10,
		CompletionTokens: 20,
		Quota:            100,
	}, base))
	require.NoError(t, model.RecordTokenUsageData(2, "bob", model.RecordConsumeLogParams{
		TokenId:          21,
		TokenName:        "bob-main",
		ModelName:        "gpt-test",
		PromptTokens:     100,
		CompletionTokens: 200,
		Quota:            999,
	}, base))

	ctx, recorder := newAuthenticatedContext(t, http.MethodGet, "/api/token_usage/self?granularity=hour&start_timestamp=1699990000&end_timestamp=1700010000", nil, 1)
	GetTokenUsageSelf(ctx)

	var response tokenUsageAPIResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, response.Message)
	require.Equal(t, int64(1), response.Data.Summary.TotalRequests)
	require.Equal(t, int64(100), response.Data.Summary.TotalQuota)
	require.Len(t, response.Data.ByToken, 1)
	require.Equal(t, 11, response.Data.ByToken[0].TokenID)
}
