package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildErrorFingerprintNormalizesDynamicValues(t *testing.T) {
	first := buildErrorFingerprint(
		"upstream_error",
		"server_error",
		500,
		"request 123 failed for 550e8400-e29b-41d4-a716-446655440000 at https://api.example.com/v1/tasks/123",
	)
	second := buildErrorFingerprint(
		"upstream_error",
		"server_error",
		500,
		"request 987 failed for 123e4567-e89b-12d3-a456-426614174000 at https://api.example.com/v1/tasks/987",
	)
	different := buildErrorFingerprint(
		"upstream_error",
		"rate_limit",
		429,
		"request 987 failed for 123e4567-e89b-12d3-a456-426614174000 at https://api.example.com/v1/tasks/987",
	)

	assert.Equal(t, first, second)
	assert.NotEqual(t, first, different)
}

func TestGetErrorLogSummaryGroupsByFingerprintAndGroup(t *testing.T) {
	now := time.Now().Unix()
	modelName := "error-summary-" + t.Name()
	channelId := 91001
	require.NoError(t, DB.Create(&Channel{
		Id:     channelId,
		Name:   "summary-test-channel",
		Status: common.ChannelStatusEnabled,
	}).Error)
	t.Cleanup(func() {
		require.NoError(t, DB.Delete(&Channel{}, channelId).Error)
	})
	errorOther := common.MapToJsonStr(map[string]interface{}{
		"error_type":  "upstream_error",
		"error_code":  "server_error",
		"status_code": 500,
	})
	logs := []Log{
		{
			UserId:    1001,
			CreatedAt: now - 30,
			Type:      LogTypeError,
			Content:   "request 123 failed for 550e8400-e29b-41d4-a716-446655440000",
			ModelName: modelName,
			ChannelId: channelId,
			Group:     "group-a",
			RequestId: "request-a",
			Other:     errorOther,
		},
		{
			UserId:    1002,
			CreatedAt: now - 20,
			Type:      LogTypeError,
			Content:   "request 987 failed for 123e4567-e89b-12d3-a456-426614174000",
			ModelName: modelName,
			ChannelId: channelId,
			Group:     "group-a",
			RequestId: "request-b",
			Other:     errorOther,
		},
		{
			UserId:    1002,
			CreatedAt: now - 10,
			Type:      LogTypeConsume,
			Content:   "success",
			ModelName: modelName,
			ChannelId: channelId,
			Group:     "group-a",
			RequestId: "request-c",
			Other:     "{}",
		},
		{
			UserId:    1003,
			CreatedAt: now - 5,
			Type:      LogTypeError,
			Content:   "request 456 failed for 550e8400-e29b-41d4-a716-446655440000",
			ModelName: modelName,
			ChannelId: channelId,
			Group:     "group-b",
			RequestId: "request-d",
			Other:     errorOther,
		},
	}

	require.NoError(t, LOG_DB.Create(&logs).Error)
	t.Cleanup(func() {
		require.NoError(t, LOG_DB.Where("model_name = ?", modelName).Delete(&Log{}).Error)
	})

	summary, err := GetErrorLogSummary(ErrorLogSummaryQuery{
		StartTime: now - 3600,
		EndTime:   now + 1,
		ModelName: modelName,
		Limit:     10,
	})
	require.NoError(t, err)
	require.Len(t, summary.Items, 2)

	itemsByGroup := make(map[string]*ErrorLogSummaryItem, len(summary.Items))
	for _, item := range summary.Items {
		itemsByGroup[item.Group] = item
	}

	groupA := itemsByGroup["group-a"]
	require.NotNil(t, groupA)
	assert.NotEmpty(t, groupA.Fingerprint)
	assert.Equal(t, 2, groupA.Count)
	assert.Equal(t, 2, groupA.AffectedRequests)
	assert.Equal(t, 2, groupA.AffectedUsers)
	assert.Equal(t, 2, groupA.CurrentCount)
	assert.Equal(t, 0, groupA.PreviousCount)
	assert.Equal(t, "new", groupA.Trend)
	assert.Equal(t, 3, groupA.RouteAttemptCount)
	assert.Equal(t, 1, groupA.RouteSuccessCount)
	assert.Equal(t, 2, groupA.RouteErrorCount)
	assert.InDelta(t, 2.0/3.0, groupA.RouteErrorRate, 0.0001)
	assert.Equal(t, "high", groupA.Severity)

	groupB := itemsByGroup["group-b"]
	require.NotNil(t, groupB)
	assert.Equal(t, 1, groupB.Count)
	assert.Equal(t, 1, groupB.RouteAttemptCount)
	assert.Equal(t, 1, groupB.RouteErrorCount)
}
