package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func setupTokenUsageDataTest(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&TokenUsageData{}))
	require.NoError(t, DB.Exec("DELETE FROM token_usage_data").Error)
	t.Cleanup(func() {
		_ = DB.Exec("DELETE FROM token_usage_data").Error
	})
}

func TestRecordTokenUsageDataAggregatesHourlyAndIgnoresZeroToken(t *testing.T) {
	setupTokenUsageDataTest(t)

	base := int64(1700000300)
	require.NoError(t, RecordTokenUsageData(1, "alice", RecordConsumeLogParams{
		TokenId:          0,
		TokenName:        "ignored",
		ModelName:        "gpt-test",
		PromptTokens:     1,
		CompletionTokens: 2,
		Quota:            3,
	}, base))

	var count int64
	require.NoError(t, DB.Model(&TokenUsageData{}).Count(&count).Error)
	require.Equal(t, int64(0), count)

	params := RecordConsumeLogParams{
		TokenId:          11,
		TokenName:        "key-a",
		ModelName:        "gpt-test",
		PromptTokens:     10,
		CompletionTokens: 20,
		Quota:            100,
	}
	require.NoError(t, RecordTokenUsageData(1, "alice", params, base))
	params.TokenName = "key-a-renamed"
	params.PromptTokens = 15
	params.CompletionTokens = 25
	params.Quota = 150
	require.NoError(t, RecordTokenUsageData(1, "alice", params, base+1200))

	var row TokenUsageData
	require.NoError(t, DB.First(&row).Error)
	require.Equal(t, int64(2), row.Count)
	require.Equal(t, int64(250), row.Quota)
	require.Equal(t, int64(25), row.PromptTokens)
	require.Equal(t, int64(45), row.CompletionTokens)
	require.Equal(t, int64(70), row.TotalTokens)
	require.Equal(t, base-base%3600, row.CreatedAt)
	require.Equal(t, "key-a-renamed", row.TokenName)
	require.Equal(t, base+1200, row.LastUsedAt)
}

func TestGetTokenUsageSelfFiltersByAuthenticatedUserTokenAndModel(t *testing.T) {
	setupTokenUsageDataTest(t)

	base := int64(1700000300)
	require.NoError(t, RecordTokenUsageData(1, "alice", RecordConsumeLogParams{
		TokenId:          11,
		TokenName:        "alice-main",
		ModelName:        "gpt-test",
		PromptTokens:     10,
		CompletionTokens: 20,
		Quota:            100,
	}, base))
	require.NoError(t, RecordTokenUsageData(1, "alice", RecordConsumeLogParams{
		TokenId:          11,
		TokenName:        "alice-main",
		ModelName:        "gpt-test",
		PromptTokens:     2,
		CompletionTokens: 3,
		Quota:            50,
	}, base+60))
	require.NoError(t, RecordTokenUsageData(1, "alice", RecordConsumeLogParams{
		TokenId:          12,
		TokenName:        "alice-second",
		ModelName:        "claude-test",
		PromptTokens:     4,
		CompletionTokens: 5,
		Quota:            80,
	}, base+3600))
	require.NoError(t, RecordTokenUsageData(2, "bob", RecordConsumeLogParams{
		TokenId:          21,
		TokenName:        "bob-main",
		ModelName:        "gpt-test",
		PromptTokens:     100,
		CompletionTokens: 200,
		Quota:            999,
	}, base))

	resp, err := GetTokenUsageSelf(1, TokenUsageQuery{
		StartTimestamp: base - 3600,
		EndTimestamp:   base + 7200,
		TokenID:        11,
		ModelName:      "gpt-test",
		Granularity:    "hour",
		DetailLimit:    10,
	})
	require.NoError(t, err)
	require.Equal(t, int64(2), resp.Summary.TotalRequests)
	require.Equal(t, int64(150), resp.Summary.TotalQuota)
	require.Equal(t, int64(35), resp.Summary.TotalTokens)
	require.Equal(t, int64(1), resp.Summary.ApiKeyCount)
	require.Equal(t, int64(1), resp.Summary.ModelCount)
	require.Len(t, resp.ByToken, 1)
	require.Equal(t, 11, resp.ByToken[0].TokenID)
	require.Len(t, resp.ByModel, 1)
	require.Equal(t, "gpt-test", resp.ByModel[0].ModelName)
	require.Len(t, resp.Rows, 1)
	require.Equal(t, 11, resp.Rows[0].TokenID)

	allResp, err := GetTokenUsageSelf(1, TokenUsageQuery{
		StartTimestamp: base - 3600,
		EndTimestamp:   base + 7200,
		Granularity:    "day",
		DetailLimit:    10,
	})
	require.NoError(t, err)
	require.Equal(t, int64(3), allResp.Summary.TotalRequests)
	require.Equal(t, int64(230), allResp.Summary.TotalQuota)
	require.Equal(t, int64(2), allResp.Summary.ApiKeyCount)
	require.Equal(t, int64(2), allResp.Summary.ModelCount)
}

func TestGetTokenUsageSelfAggregatesTrendByDay(t *testing.T) {
	setupTokenUsageDataTest(t)

	firstDay := time.Date(2026, 1, 2, 1, 0, 0, 0, time.Local).Unix()
	secondDay := time.Date(2026, 1, 3, 2, 0, 0, 0, time.Local).Unix()
	params := RecordConsumeLogParams{
		TokenId:          11,
		TokenName:        "daily-key",
		ModelName:        "gpt-test",
		PromptTokens:     1,
		CompletionTokens: 1,
		Quota:            10,
	}
	require.NoError(t, RecordTokenUsageData(1, "alice", params, firstDay))
	require.NoError(t, RecordTokenUsageData(1, "alice", params, firstDay+3600))
	require.NoError(t, RecordTokenUsageData(1, "alice", params, secondDay))

	resp, err := GetTokenUsageSelf(1, TokenUsageQuery{
		StartTimestamp: firstDay - 3600,
		EndTimestamp:   secondDay + 3600,
		Granularity:    "day",
		DetailLimit:    10,
	})
	require.NoError(t, err)
	require.Len(t, resp.Trend, 2)
	require.Equal(t, int64(2), resp.Trend[0].Count)
	require.Equal(t, int64(20), resp.Trend[0].Quota)
	require.Equal(t, int64(1), resp.Trend[1].Count)
	require.Equal(t, int64(10), resp.Trend[1].Quota)
	require.Less(t, resp.Trend[0].Timestamp, resp.Trend[1].Timestamp)
}
