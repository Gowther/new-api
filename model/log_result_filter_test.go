package model

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The result filter must partition logs exactly the way SumUsedQuota splits
// success_count from total_count: failed = every error log plus any consume
// log without positive prompt and completion tokens (NULL included).
func TestLogResultFilterMatchesSuccessRateAccounting(t *testing.T) {
	now := time.Now().Unix()
	username := t.Name()
	logs := []Log{
		{CreatedAt: now - 5, Type: LogTypeConsume, Username: username, UserId: 876002, PromptTokens: 10, CompletionTokens: 20, Quota: 3}, // success
		{CreatedAt: now - 5, Type: LogTypeConsume, Username: username, UserId: 876002, PromptTokens: 10, CompletionTokens: 0},          // failed: zero completion
		{CreatedAt: now - 5, Type: LogTypeConsume, Username: username, UserId: 876002},                                                 // failed: both zero
		{CreatedAt: now - 5, Type: LogTypeConsume, Username: username, UserId: 876002, PromptTokens: 10, CompletionTokens: 10},         // failed: NULL after update below
		{CreatedAt: now - 5, Type: LogTypeError, Username: username, UserId: 876002},                                                   // failed: error log
		{CreatedAt: now - 5, Type: LogTypeTopup, Username: username, UserId: 876002, Quota: 100},                                       // neither success nor failed
	}
	require.NoError(t, LOG_DB.Create(&logs).Error)
	t.Cleanup(func() {
		require.NoError(t, LOG_DB.Where("username = ?", username).Delete(&Log{}).Error)
	})
	require.NoError(t, LOG_DB.Model(&logs[3]).Updates(map[string]any{"prompt_tokens": nil, "completion_tokens": nil}).Error)

	baseQuery := LogStatQuery{StartTimestamp: now - 300, EndTimestamp: now, Username: username}

	unfiltered, err := SumUsedQuota(context.Background(), baseQuery)
	require.NoError(t, err)
	assert.Equal(t, 5, unfiltered.TotalCount)
	assert.Equal(t, 1, unfiltered.SuccessCount)
	assert.InDelta(t, 20.0, unfiltered.SuccessRate, 0.0001)

	failedQuery := baseQuery
	failedQuery.Result = LogResultFailed
	failed, err := SumUsedQuota(context.Background(), failedQuery)
	require.NoError(t, err)
	assert.Equal(t, 4, failed.TotalCount)
	assert.Equal(t, 0, failed.SuccessCount)
	assert.Zero(t, failed.SuccessRate)
	assert.Equal(t, 0, failed.Quota)

	successQuery := baseQuery
	successQuery.Result = LogResultSuccess
	success, err := SumUsedQuota(context.Background(), successQuery)
	require.NoError(t, err)
	assert.Equal(t, 1, success.TotalCount)
	assert.Equal(t, 1, success.SuccessCount)
	assert.Equal(t, 100.0, success.SuccessRate)
	assert.Equal(t, 3, success.Quota)

	// Result composes with the log-type filter instead of replacing it.
	failedConsumeQuery := failedQuery
	failedConsumeQuery.LogType = LogTypeConsume
	failedConsume, err := SumUsedQuota(context.Background(), failedConsumeQuery)
	require.NoError(t, err)
	assert.Equal(t, 3, failedConsume.TotalCount)

	// Unknown values degrade to no filter.
	bogusQuery := baseQuery
	bogusQuery.Result = "bogus"
	bogus, err := SumUsedQuota(context.Background(), bogusQuery)
	require.NoError(t, err)
	assert.Equal(t, unfiltered.TotalCount, bogus.TotalCount)

	// The list endpoints must agree with the stat partition row for row.
	_, failedTotal, err := GetAllLogs(LogTypeUnknown, now-300, now, "", username, "", 0, 10, 0, "", "", "", LogResultFailed)
	require.NoError(t, err)
	assert.Equal(t, int64(4), failedTotal)

	_, successTotal, err := GetAllLogs(LogTypeUnknown, now-300, now, "", username, "", 0, 10, 0, "", "", "", LogResultSuccess)
	require.NoError(t, err)
	assert.Equal(t, int64(1), successTotal)

	_, allTotal, err := GetAllLogs(LogTypeUnknown, now-300, now, "", username, "", 0, 10, 0, "", "", "", "")
	require.NoError(t, err)
	assert.Equal(t, int64(6), allTotal)

	_, userFailedTotal, err := GetUserLogs(876002, LogTypeUnknown, now-300, now, "", "", 0, 10, "", "", "", LogResultFailed)
	require.NoError(t, err)
	assert.Equal(t, int64(4), userFailedTotal)
}
