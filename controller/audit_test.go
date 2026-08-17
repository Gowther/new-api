package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAuditContentENChannelRoutingOverrideTemplates(t *testing.T) {
	tests := []struct {
		name     string
		action   string
		params   map[string]interface{}
		expected string
	}{
		{
			name:   "set channel-wide override",
			action: "channel.routing_override_set",
			params: map[string]interface{}{
				"channel_id":   209,
				"channel_name": "primary",
				"models":       "gpt-5.5,gpt-5.6-sol",
				"model_count":  2,
				"groups":       "default,premium",
			},
			expected: "Enabled temporary single-channel routing through channel primary (ID: 209) for 2 models (gpt-5.5,gpt-5.6-sol) in groups default,premium",
		},
		{
			name:     "restore channel-wide override",
			action:   "channel.routing_override_delete",
			params:   map[string]interface{}{"count": 4},
			expected: "Restored normal routing by removing 4 temporary routing rules",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			content := auditContentEN(test.action, test.params)
			assert.Equal(t, test.expected, content)
			assert.NotContains(t, content, "${")
		})
	}
}
