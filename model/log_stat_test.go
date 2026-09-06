package model

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSumUsedQuotaIncludesTotalTokensForSelectedRange(t *testing.T) {
	now := time.Now().Unix()
	username := t.Name()
	logs := []Log{
		{
			CreatedAt:        now - 600,
			Type:             LogTypeConsume,
			Username:         username,
			Quota:            99,
			PromptTokens:     400,
			CompletionTokens: 100,
		},
		{
			CreatedAt:        now - 120,
			Type:             LogTypeConsume,
			Username:         username,
			Quota:            10,
			PromptTokens:     100,
			CompletionTokens: 50,
		},
		{
			CreatedAt:        now - 5,
			Type:             LogTypeConsume,
			Username:         username,
			Quota:            7,
			PromptTokens:     20,
			CompletionTokens: 10,
		},
	}

	require.NoError(t, LOG_DB.Create(&logs).Error)
	t.Cleanup(func() {
		require.NoError(t, LOG_DB.Where("username = ?", username).Delete(&Log{}).Error)
	})

	query := LogStatQuery{LogType: LogTypeConsume, StartTimestamp: now - 300, EndTimestamp: now, Username: username}
	stat, err := SumUsedQuota(context.Background(), query)
	require.NoError(t, err)
	assert.Equal(t, 17, stat.Quota)
	assert.Equal(t, int64(180), stat.TotalTokens)
	assert.Equal(t, 1, stat.Rpm)
	assert.Equal(t, 30, stat.Tpm)
	assert.Equal(t, 2, stat.SuccessCount)
	assert.Equal(t, 2, stat.TotalCount)
	assert.Equal(t, 100.0, stat.SuccessRate)

	query.EndTimestamp = now - 60
	stat, err = SumUsedQuota(context.Background(), query)
	require.NoError(t, err)
	assert.Equal(t, 10, stat.Quota)
	assert.Equal(t, int64(150), stat.TotalTokens)
	assert.Equal(t, 1, stat.TotalCount)
	assert.Equal(t, 1, stat.Rpm)
	assert.Equal(t, 30, stat.Tpm)
}

func TestSumUsedQuotaCountsInvalidAndErrorRequestsAsFailures(t *testing.T) {
	now := time.Now().Unix()
	username := t.Name()
	logs := []Log{
		{
			CreatedAt:        now - 5,
			Type:             LogTypeConsume,
			Username:         username,
			PromptTokens:     100,
			CompletionTokens: 50,
		},
		{
			CreatedAt:        now - 10,
			Type:             LogTypeConsume,
			Username:         username,
			PromptTokens:     0,
			CompletionTokens: 50,
		},
		{
			CreatedAt:        now - 15,
			Type:             LogTypeConsume,
			Username:         username,
			PromptTokens:     100,
			CompletionTokens: 0,
		},
		{
			CreatedAt: now - 20,
			Type:      LogTypeError,
			Username:  username,
		},
	}

	require.NoError(t, LOG_DB.Create(&logs).Error)
	t.Cleanup(func() {
		require.NoError(t, LOG_DB.Where("username = ?", username).Delete(&Log{}).Error)
	})

	query := LogStatQuery{StartTimestamp: now - 60, EndTimestamp: now, Username: username}
	stat, err := SumUsedQuota(context.Background(), query)
	require.NoError(t, err)
	assert.Equal(t, 4, stat.Rpm)
	assert.Equal(t, 1, stat.SuccessCount)
	assert.Equal(t, 4, stat.TotalCount)
	assert.InDelta(t, 25.0, stat.SuccessRate, 0.0001)

	query.LogType = LogTypeConsume
	consumeStat, err := SumUsedQuota(context.Background(), query)
	require.NoError(t, err)
	assert.Equal(t, 3, consumeStat.TotalCount)
	assert.Equal(t, 1, consumeStat.SuccessCount)

	query.LogType = LogTypeError
	errorStat, err := SumUsedQuota(context.Background(), query)
	require.NoError(t, err)
	assert.Equal(t, 1, errorStat.TotalCount)
	assert.Equal(t, 0, errorStat.SuccessCount)
	assert.Zero(t, errorStat.SuccessRate)
}

func TestSumUsedQuotaCountsNullTokensAndExcludesNonRequests(t *testing.T) {
	now := time.Now().Unix()
	username := t.Name()
	logs := []Log{
		{CreatedAt: now - 120, Type: LogTypeConsume, Username: username, PromptTokens: 10, CompletionTokens: 20},
		{CreatedAt: now - 120, Type: LogTypeConsume, Username: username, PromptTokens: 10, CompletionTokens: 20},
		{CreatedAt: now - 120, Type: LogTypeConsume, Username: username, PromptTokens: 10, CompletionTokens: 20},
		{CreatedAt: now - 120, Type: LogTypeError, Username: username},
	}
	for _, logType := range []int{LogTypeTopup, LogTypeManage, LogTypeSystem, LogTypeRefund, LogTypeLogin} {
		logs = append(logs, Log{CreatedAt: now - 120, Type: logType, Username: username, PromptTokens: 10, CompletionTokens: 20})
	}
	require.NoError(t, LOG_DB.Create(&logs).Error)
	t.Cleanup(func() {
		require.NoError(t, LOG_DB.Where("username = ?", username).Delete(&Log{}).Error)
	})
	require.NoError(t, LOG_DB.Model(&logs[1]).Update("prompt_tokens", nil).Error)
	require.NoError(t, LOG_DB.Model(&logs[2]).Update("completion_tokens", nil).Error)

	query := LogStatQuery{StartTimestamp: now - 300, EndTimestamp: now - 60, Username: username}
	stat, err := SumUsedQuota(context.Background(), query)
	require.NoError(t, err)
	assert.Equal(t, 4, stat.TotalCount)
	assert.Equal(t, 1, stat.SuccessCount)
	assert.Equal(t, 25.0, stat.SuccessRate)
	assert.Zero(t, stat.Rpm)
	assert.Zero(t, stat.Tpm)

	query.LogType = LogTypeTopup
	stat, err = SumUsedQuota(context.Background(), query)
	require.NoError(t, err)
	assert.Zero(t, stat.TotalCount)
	assert.Zero(t, stat.SuccessCount)
	assert.Zero(t, stat.SuccessRate)
}

func TestSumUsedQuotaUsesAllRequestFilters(t *testing.T) {
	now := time.Now().Unix()
	username := t.Name()
	matching := Log{
		CreatedAt: now - 5, Type: LogTypeConsume, Username: username,
		UserId: 876001, TokenName: "selected-token", ModelName: "gpt-selected", ChannelId: 123,
		Group: "selected-group", RequestId: "selected-request", UpstreamRequestId: "selected-upstream",
		PromptTokens: 10, CompletionTokens: 20, Quota: 5,
	}
	logs := []Log{matching}
	for i := 0; i < 7; i++ {
		other := matching
		other.Type = LogTypeError
		switch i {
		case 0:
			other.UserId++
		case 1:
			other.TokenName = "other-token"
		case 2:
			other.ModelName = "other-model"
		case 3:
			other.ChannelId++
		case 4:
			other.Group = "other-group"
		case 5:
			other.RequestId = "other-request"
		case 6:
			other.UpstreamRequestId = "other-upstream"
		}
		logs = append(logs, other)
	}
	require.NoError(t, LOG_DB.Create(&logs).Error)
	t.Cleanup(func() {
		require.NoError(t, LOG_DB.Where("username = ?", username).Delete(&Log{}).Error)
	})

	query := LogStatQuery{
		StartTimestamp: now - 300, EndTimestamp: now, Username: username, UserId: matching.UserId,
		TokenName: matching.TokenName, ModelName: "selected", Channel: matching.ChannelId,
		Group: matching.Group, RequestId: matching.RequestId, UpstreamRequestId: matching.UpstreamRequestId,
	}
	stat, err := SumUsedQuota(context.Background(), query)
	require.NoError(t, err)
	assert.Equal(t, Stat{Quota: 5, TotalTokens: 30, Rpm: 1, Tpm: 30, SuccessCount: 1, TotalCount: 1, SuccessRate: 100}, stat)

	query.RequestId = "missing"
	stat, err = SumUsedQuota(context.Background(), query)
	require.NoError(t, err)
	assert.Equal(t, Stat{}, stat)
}
