package model

import (
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

	stat, err := SumUsedQuota(LogTypeConsume, now-300, now, "", username, "", 0, "")
	require.NoError(t, err)
	assert.Equal(t, 17, stat.Quota)
	assert.Equal(t, int64(180), stat.TotalTokens)
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

	stat, err := SumUsedQuota(LogTypeUnknown, now-60, now, "", username, "", 0, "")
	require.NoError(t, err)
	assert.Equal(t, 4, stat.Rpm)
	assert.Equal(t, 1, stat.SuccessCount)
	assert.Equal(t, 4, stat.TotalCount)
	assert.InDelta(t, 25.0, stat.SuccessRate, 0.0001)

	consumeStat, err := SumUsedQuota(LogTypeConsume, now-60, now, "", username, "", 0, "")
	require.NoError(t, err)
	assert.Equal(t, 3, consumeStat.TotalCount)
	assert.Equal(t, 1, consumeStat.SuccessCount)

	errorStat, err := SumUsedQuota(LogTypeError, now-60, now, "", username, "", 0, "")
	require.NoError(t, err)
	assert.Equal(t, 1, errorStat.TotalCount)
	assert.Equal(t, 0, errorStat.SuccessCount)
	assert.Zero(t, errorStat.SuccessRate)
}
