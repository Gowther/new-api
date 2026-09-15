package service

import (
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newDisableTestError(statusCode int, message string) *types.NewAPIError {
	return types.NewErrorWithStatusCode(errors.New(message), types.ErrorCodeBadResponseStatusCode, statusCode)
}

func TestShouldDisableChannelWithRules(t *testing.T) {
	// The default global keyword list contains "permission denied" and the
	// default global status-code list contains 401.
	globalKeywordErr := newDisableTestError(500, "Permission denied")
	globalStatusCodeErr := newDisableTestError(401, "some unrelated error")
	unrelatedErr := newDisableTestError(404, "some unrelated error")

	channelRules := &types.ChannelAutoBanRules{
		StatusCodes: "429,500-502",
		Keywords:    []string{"Insufficient Quota"},
	}

	tests := []struct {
		name         string
		globalEnable bool
		autoBanMode  int
		rules        *types.ChannelAutoBanRules
		err          *types.NewAPIError
		want         bool
	}{
		{
			name:         "follow global with global switch off",
			globalEnable: false,
			autoBanMode:  1,
			rules:        nil,
			err:          globalStatusCodeErr,
			want:         false,
		},
		{
			name:         "follow global matches global status code",
			globalEnable: true,
			autoBanMode:  1,
			rules:        nil,
			err:          globalStatusCodeErr,
			want:         true,
		},
		{
			name:         "follow global matches global keyword",
			globalEnable: true,
			autoBanMode:  1,
			rules:        nil,
			err:          globalKeywordErr,
			want:         true,
		},
		{
			name:         "follow global ignores unrelated error",
			globalEnable: true,
			autoBanMode:  1,
			rules:        nil,
			err:          unrelatedErr,
			want:         false,
		},
		{
			name:         "force on works with global switch off",
			globalEnable: false,
			autoBanMode:  2,
			rules:        nil,
			err:          globalStatusCodeErr,
			want:         true,
		},
		{
			name:         "force off wins over global switch",
			globalEnable: true,
			autoBanMode:  0,
			rules:        nil,
			err:          globalStatusCodeErr,
			want:         false,
		},
		{
			name:         "custom rules replace global status codes",
			globalEnable: true,
			autoBanMode:  1,
			rules:        channelRules,
			err:          globalStatusCodeErr,
			want:         false,
		},
		{
			name:         "custom rules match channel status code",
			globalEnable: true,
			autoBanMode:  1,
			rules:        channelRules,
			err:          newDisableTestError(429, "rate limited"),
			want:         true,
		},
		{
			name:         "custom rules match channel status code range",
			globalEnable: false,
			autoBanMode:  2,
			rules:        channelRules,
			err:          newDisableTestError(501, "not implemented"),
			want:         true,
		},
		{
			name:         "custom rules match channel keyword case-insensitively",
			globalEnable: true,
			autoBanMode:  1,
			rules:        channelRules,
			err:          newDisableTestError(200, "you have INSUFFICIENT QUOTA left"),
			want:         true,
		},
		{
			name:         "custom rules ignore unrelated error",
			globalEnable: true,
			autoBanMode:  1,
			rules:        channelRules,
			err:          unrelatedErr,
			want:         false,
		},
		{
			name:         "custom rules with empty lists disable nothing",
			globalEnable: true,
			autoBanMode:  1,
			rules:        &types.ChannelAutoBanRules{},
			err:          globalStatusCodeErr,
			want:         false,
		},
		{
			name:         "nil error never disables",
			globalEnable: true,
			autoBanMode:  2,
			rules:        channelRules,
			err:          nil,
			want:         false,
		},
		{
			name:         "invalid mode treated as follow global",
			globalEnable: true,
			autoBanMode:  7,
			rules:        nil,
			err:          globalStatusCodeErr,
			want:         true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			original := common.AutomaticDisableChannelEnabled
			common.AutomaticDisableChannelEnabled = tt.globalEnable
			t.Cleanup(func() { common.AutomaticDisableChannelEnabled = original })

			got := ShouldDisableChannelWithRules(tt.err, tt.autoBanMode, tt.rules)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestChannelGetAutoBanMode(t *testing.T) {
	one := 1
	two := 2
	zero := 0
	invalid := 9

	require.Equal(t, 1, (&model.Channel{}).GetAutoBanMode())
	assert.Equal(t, 0, (&model.Channel{AutoBan: &zero}).GetAutoBanMode())
	assert.Equal(t, 1, (&model.Channel{AutoBan: &one}).GetAutoBanMode())
	assert.Equal(t, 2, (&model.Channel{AutoBan: &two}).GetAutoBanMode())
	assert.Equal(t, 1, (&model.Channel{AutoBan: &invalid}).GetAutoBanMode())
}
