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
