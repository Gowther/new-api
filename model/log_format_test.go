package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/require"
)

// TestFormatUserLogsStripsQuotaSaturation verifies the admin-only quota
// saturation marker (nested under other.admin_info) is removed for non-admin
// log views, since formatUserLogs strips the whole admin_info object.
func TestFormatUserLogsStripsQuotaSaturation(t *testing.T) {
	other := common.MapToJsonStr(map[string]interface{}{
		"model_price": 0.004,
		"admin_info": map[string]interface{}{
			"quota_saturation": map[string]interface{}{
				"op":      "QuotaFromDecimal",
				"kind":    "overflow",
				"clamped": common.MaxQuota,
			},
		},
	})
	logs := []*Log{{Other: other}}

	formatUserLogs(logs, 0)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	_, hasAdminInfo := parsed["admin_info"]
	require.False(t, hasAdminInfo, "admin_info (and nested quota_saturation) must be stripped for non-admin views")
	// Non-admin billing fields remain visible.
	require.Contains(t, parsed, "model_price")
}

// TestFormatUserLogsStripsLegacyChannelMetadata verifies that legacy
// top-level other fields (channel metadata and admin-set reject reasons)
// are stripped from user-visible logs — they let users enumerate backend
// channels. New writes carry them under other.admin_info instead.
func TestFormatUserLogsStripsLegacyChannelMetadata(t *testing.T) {
	other := common.MapToJsonStr(map[string]interface{}{
		"model_ratio":   0.002,
		"channel_id":    42,
		"channel_name":  "secret-channel",
		"channel_type":  1,
		"reject_reason": "admin-set reason",
		"admin_info": map[string]interface{}{
			"channel_id":    42,
			"channel_name":  "secret-channel",
			"reject_reason": "admin-set reason",
		},
	})
	logs := []*Log{{Other: other}}

	formatUserLogs(logs, 0)

	parsed, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	for _, key := range []string{"channel_id", "channel_name", "channel_type", "reject_reason", "admin_info"} {
		require.NotContains(t, parsed, key)
	}
	require.Contains(t, parsed, "model_ratio")
}
