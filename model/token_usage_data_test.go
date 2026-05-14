package model

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func setupTokenUsageDataTest(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&TokenUsageData{}, &Log{}, &Option{}))
	require.NoError(t, DB.Exec("DELETE FROM token_usage_data").Error)
	require.NoError(t, DB.Exec("DELETE FROM logs").Error)
	require.NoError(t, DB.Where("key = ?", tokenUsageBackfillOptionKey).Delete(&Option{}).Error)
	t.Cleanup(func() {
		_ = DB.Exec("DELETE FROM token_usage_data").Error
		_ = DB.Exec("DELETE FROM logs").Error
		_ = DB.Where("key = ?", tokenUsageBackfillOptionKey).Delete(&Option{}).Error
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
		Other: map[string]interface{}{
			"cache_tokens":          3,
			"cache_creation_tokens": 4,
		},
	}
	require.NoError(t, RecordTokenUsageData(1, "alice", params, base))
	params.TokenName = "key-a-renamed"
	params.PromptTokens = 15
	params.CompletionTokens = 25
	params.Quota = 150
	params.Other = map[string]interface{}{
		"cache_tokens":             5,
		"cache_creation_tokens_5m": 6,
		"cache_creation_tokens_1h": 7,
		"cache_creation_tokens":    99,
	}
	require.NoError(t, RecordTokenUsageData(1, "alice", params, base+1200))

	var row TokenUsageData
	require.NoError(t, DB.First(&row).Error)
	require.Equal(t, int64(2), row.Count)
	require.Equal(t, int64(250), row.Quota)
	require.Equal(t, int64(25), row.PromptTokens)
	require.Equal(t, int64(45), row.CompletionTokens)
	require.Equal(t, int64(70), row.TotalTokens)
	require.Equal(t, int64(8), row.CacheReadTokens)
	require.Equal(t, int64(17), row.CacheWriteTokens)
	require.Equal(t, base-base%3600, row.CreatedAt)
	require.Equal(t, "key-a-renamed", row.TokenName)
	require.Equal(t, base+1200, row.LastUsedAt)
}

func TestTokenUsageExistingColumnQualifiesPostgreSQLUpsertColumns(t *testing.T) {
	oldUsingPostgreSQL := common.UsingPostgreSQL
	t.Cleanup(func() {
		common.UsingPostgreSQL = oldUsingPostgreSQL
	})

	common.UsingPostgreSQL = true
	require.Equal(t, `"token_usage_data"."completion_tokens"`, tokenUsageExistingColumn("completion_tokens"))

	common.UsingPostgreSQL = false
	require.Equal(t, "completion_tokens", tokenUsageExistingColumn("completion_tokens"))
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
		Other: map[string]interface{}{
			"cache_tokens":          2,
			"cache_creation_tokens": 3,
		},
	}, base))
	require.NoError(t, RecordTokenUsageData(1, "alice", RecordConsumeLogParams{
		TokenId:          11,
		TokenName:        "alice-main",
		ModelName:        "gpt-test",
		PromptTokens:     2,
		CompletionTokens: 3,
		Quota:            50,
		Other: map[string]interface{}{
			"cache_tokens":             4,
			"cache_creation_tokens_5m": 5,
		},
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
	require.Equal(t, int64(6), resp.Summary.TotalCacheReadTokens)
	require.Equal(t, int64(8), resp.Summary.TotalCacheWriteTokens)
	require.Equal(t, int64(1), resp.Summary.ApiKeyCount)
	require.Equal(t, int64(1), resp.Summary.ModelCount)
	require.Len(t, resp.ByToken, 1)
	require.Equal(t, 11, resp.ByToken[0].TokenID)
	require.Len(t, resp.ByModel, 1)
	require.Equal(t, "gpt-test", resp.ByModel[0].ModelName)
	require.Len(t, resp.Rows, 1)
	require.Equal(t, 11, resp.Rows[0].TokenID)
	require.Equal(t, int64(6), resp.Rows[0].CacheReadTokens)
	require.Equal(t, int64(8), resp.Rows[0].CacheWriteTokens)

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

func TestBackfillTokenUsageDataFromLogsRebuildsRecentWindow(t *testing.T) {
	setupTokenUsageDataTest(t)

	now := time.Date(2026, 5, 14, 19, 30, 0, 0, time.Local).Unix()
	currentHour := now - now%3600
	previousHour := currentHour - 3600
	oldTimestamp := currentHour - 91*24*3600

	require.NoError(t, DB.Create(&TokenUsageData{
		UserID:           1,
		Username:         "stale",
		TokenID:          11,
		TokenName:        "stale-key",
		ModelName:        "gpt-test",
		CreatedAt:        previousHour,
		Count:            99,
		Quota:            990,
		PromptTokens:     990,
		CompletionTokens: 990,
		TotalTokens:      1980,
		LastUsedAt:       previousHour,
	}).Error)

	logs := []Log{
		{
			UserId:           1,
			Username:         "alice",
			CreatedAt:        previousHour + 60,
			Type:             LogTypeConsume,
			TokenId:          11,
			TokenName:        "alice-main",
			ModelName:        "gpt-test",
			Quota:            100,
			PromptTokens:     10,
			CompletionTokens: 20,
			Other: common.MapToJsonStr(map[string]interface{}{
				"cache_tokens":          3,
				"cache_creation_tokens": 4,
			}),
		},
		{
			UserId:           1,
			Username:         "alice",
			CreatedAt:        previousHour + 120,
			Type:             LogTypeConsume,
			TokenId:          11,
			TokenName:        "alice-renamed",
			ModelName:        "gpt-test",
			Quota:            150,
			PromptTokens:     15,
			CompletionTokens: 25,
			Other: common.MapToJsonStr(map[string]interface{}{
				"cache_tokens":             5,
				"cache_creation_tokens_5m": 6,
				"cache_creation_tokens_1h": 7,
				"cache_creation_tokens":    99,
			}),
		},
		{
			UserId:           2,
			Username:         "bob",
			CreatedAt:        previousHour + 180,
			Type:             LogTypeConsume,
			TokenId:          21,
			TokenName:        "bob-main",
			ModelName:        "claude-test",
			Quota:            80,
			PromptTokens:     4,
			CompletionTokens: 6,
		},
		{
			UserId:           1,
			Username:         "alice",
			CreatedAt:        previousHour + 240,
			Type:             LogTypeConsume,
			TokenId:          0,
			TokenName:        "ignored-zero-token",
			ModelName:        "gpt-test",
			Quota:            999,
			PromptTokens:     999,
			CompletionTokens: 999,
		},
		{
			UserId:           1,
			Username:         "alice",
			CreatedAt:        oldTimestamp,
			Type:             LogTypeConsume,
			TokenId:          12,
			TokenName:        "ignored-old",
			ModelName:        "gpt-test",
			Quota:            999,
			PromptTokens:     999,
			CompletionTokens: 999,
		},
		{
			UserId:           1,
			Username:         "alice",
			CreatedAt:        currentHour + 60,
			Type:             LogTypeConsume,
			TokenId:          13,
			TokenName:        "ignored-current-hour",
			ModelName:        "gpt-test",
			Quota:            999,
			PromptTokens:     999,
			CompletionTokens: 999,
		},
		{
			UserId:           1,
			Username:         "alice",
			CreatedAt:        previousHour + 300,
			Type:             LogTypeSystem,
			TokenId:          14,
			TokenName:        "ignored-non-consume",
			ModelName:        "gpt-test",
			Quota:            999,
			PromptTokens:     999,
			CompletionTokens: 999,
		},
	}
	require.NoError(t, DB.Create(&logs).Error)

	result, err := backfillTokenUsageDataFromLogs(90, now)
	require.NoError(t, err)
	require.Equal(t, 3, result.Logs)
	require.Equal(t, 2, result.Rows)

	var row TokenUsageData
	require.NoError(t, DB.Where("user_id = ? and token_id = ? and model_name = ? and created_at = ?", 1, 11, "gpt-test", previousHour).First(&row).Error)
	require.Equal(t, "alice", row.Username)
	require.Equal(t, "alice-renamed", row.TokenName)
	require.Equal(t, int64(2), row.Count)
	require.Equal(t, int64(250), row.Quota)
	require.Equal(t, int64(25), row.PromptTokens)
	require.Equal(t, int64(45), row.CompletionTokens)
	require.Equal(t, int64(70), row.TotalTokens)
	require.Equal(t, int64(8), row.CacheReadTokens)
	require.Equal(t, int64(17), row.CacheWriteTokens)
	require.Equal(t, previousHour+120, row.LastUsedAt)

	var count int64
	require.NoError(t, DB.Model(&TokenUsageData{}).Count(&count).Error)
	require.Equal(t, int64(2), count)

	result, err = backfillTokenUsageDataFromLogs(90, now)
	require.NoError(t, err)
	require.Equal(t, 3, result.Logs)
	require.Equal(t, 2, result.Rows)

	require.NoError(t, DB.Where("user_id = ? and token_id = ? and model_name = ? and created_at = ?", 1, 11, "gpt-test", previousHour).First(&row).Error)
	require.Equal(t, int64(2), row.Count)
	require.Equal(t, int64(250), row.Quota)
}

func TestRecordConsumeLogWritesTokenUsageWhenConsumeLogDisabled(t *testing.T) {
	setupTokenUsageDataTest(t)
	oldLogConsumeEnabled := common.LogConsumeEnabled
	common.LogConsumeEnabled = false
	t.Cleanup(func() {
		common.LogConsumeEnabled = oldLogConsumeEnabled
	})

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Set("username", "alice")

	RecordConsumeLog(ctx, 1, RecordConsumeLogParams{
		TokenId:          11,
		TokenName:        "alice-main",
		ModelName:        "gpt-test",
		Quota:            100,
		PromptTokens:     10,
		CompletionTokens: 20,
	})

	require.Eventually(t, func() bool {
		var row TokenUsageData
		err := DB.Where("user_id = ? and token_id = ? and model_name = ?", 1, 11, "gpt-test").First(&row).Error
		return err == nil && row.Count == 1 && row.Quota == 100 && row.TotalTokens == 30
	}, time.Second, 10*time.Millisecond)
}

func TestRecordTaskBillingLogWritesTokenUsageForConsume(t *testing.T) {
	setupTokenUsageDataTest(t)
	oldLogConsumeEnabled := common.LogConsumeEnabled
	common.LogConsumeEnabled = true
	t.Cleanup(func() {
		common.LogConsumeEnabled = oldLogConsumeEnabled
	})

	RecordTaskBillingLog(RecordTaskBillingLogParams{
		UserId:    1,
		LogType:   LogTypeConsume,
		Content:   "task delta",
		ChannelId: 2,
		ModelName: "task-model",
		Quota:     250,
		TokenId:   21,
		Group:     "default",
	})

	require.Eventually(t, func() bool {
		var row TokenUsageData
		err := DB.Where("user_id = ? and token_id = ? and model_name = ?", 1, 21, "task-model").First(&row).Error
		return err == nil && row.Count == 1 && row.Quota == 250
	}, time.Second, 10*time.Millisecond)
}
