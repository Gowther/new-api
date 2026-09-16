/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package service

import (
	"strconv"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseProbeDurationHint(t *testing.T) {
	tests := []struct {
		name   string
		text   string
		want   time.Duration
		wantOK bool
	}{
		{
			name:   "cline style combined duration",
			text:   "status_code=429, Error 429: Daily free limit reached on model z-ai/glm-5.3-flash. Try again in 3h 49m",
			want:   3*time.Hour + 49*time.Minute,
			wantOK: true,
		},
		{
			name:   "openai style seconds are read verbatim",
			text:   "Please try again in 362880 seconds.",
			want:   362880 * time.Second,
			wantOK: true,
		},
		{
			name:   "sub-minute hint still parses",
			text:   "Try again in 8s",
			want:   8 * time.Second,
			wantOK: true,
		},
		{
			name:   "retry after glued units",
			text:   "quota exceeded, retry after 2h45m",
			want:   2*time.Hour + 45*time.Minute,
			wantOK: true,
		},
		{
			name:   "chinese hint with 请于",
			text:   "今日额度已用完，请于3小时49分后重试",
			want:   3*time.Hour + 49*time.Minute,
			wantOK: true,
		},
		{
			name:   "chinese hint with duration before 重试",
			text:   "额度不足，请等 30分钟后再试",
			want:   30 * time.Minute,
			wantOK: true,
		},
		{
			name:   "no hint anywhere",
			text:   "status_code=429, Error 429: rate limit exceeded",
			wantOK: false,
		},
		{
			name:   "empty text",
			text:   "",
			wantOK: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			delay, ok := parseProbeDurationHint(tt.text)
			require.Equal(t, tt.wantOK, ok)
			if tt.wantOK {
				assert.Equal(t, tt.want, delay)
			}
		})
	}
}

func TestParseResetDateTimeHint(t *testing.T) {
	// An anchored future datetime parses on its own; nothing about the test
	// depends on the wall clock except being before it.
	resetAt := time.Now().Add(90 * time.Minute).Format("2006-01-02 15:04:05")
	parsed, ok := parseResetDateTimeHint("This model has a usage limit. Resets at " + resetAt)
	require.True(t, ok)
	assert.WithinDuration(t, time.Now().Add(90*time.Minute), parsed, 2*time.Minute)

	// A vendor style with timezone offset is honored via RFC3339.
	iso := time.Now().Add(30 * time.Minute).UTC().Format(time.RFC3339)
	parsed, ok = parseResetDateTimeHint("Try again after " + iso)
	require.True(t, ok)
	assert.WithinDuration(t, time.Now().Add(30*time.Minute), parsed, 2*time.Minute)

	// A past datetime is not a hint to act on, just an expired one.
	past, ok := parseResetDateTimeHint("Resets at 2020-01-01 00:00:00")
	require.True(t, ok)
	assert.True(t, past.Before(time.Now()))
}

func TestChannelProbeNoBefore(t *testing.T) {
	bannedAt := time.Now().Unix()

	// A duration hint is measured from the moment the reason was recorded.
	require.Equal(t, bannedAt+int64((3*time.Hour+49*time.Minute+time.Second-1)/time.Second),
		ChannelProbeNoBefore("Daily free limit reached. Try again in 3h 49m", bannedAt, bannedAt+600))
	// Once the window has passed the channel is probeable again.
	require.Zero(t, ChannelProbeNoBefore("Daily free limit reached. Try again in 3h 49m",
		bannedAt, bannedAt+int64((3*time.Hour+49*time.Minute)/time.Second)+10))
	// Sub-floor hints are clamped to one minute.
	require.Equal(t, bannedAt+60, ChannelProbeNoBefore("Try again in 8s", bannedAt, bannedAt))

	// A far-future datetime is clamped to a week.
	require.Equal(t, bannedAt+int64(MaxProbeDelay/time.Second),
		ChannelProbeNoBefore("Resets at 2030-01-01 00:00:00", bannedAt, bannedAt))
	// A past datetime means no deferral.
	require.Zero(t, ChannelProbeNoBefore("Resets at 2020-01-01 00:00:00", bannedAt, bannedAt))

	// Without a usable hint there is nothing to wait on.
	require.Zero(t, ChannelProbeNoBefore("", bannedAt, bannedAt))
	require.Zero(t, ChannelProbeNoBefore("Error 429: quota exhausted", bannedAt, bannedAt))
}

func TestChannelProbeDeferredGates(t *testing.T) {
	bannedAt := time.Now().Unix()
	now := time.Now().Unix()

	multiKey := &model.Channel{
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:             true,
			MultiKeyStatusList:     map[int]int{2: common.ChannelStatusAutoDisabled},
			MultiKeyDisabledTime:   map[int]int64{2: bannedAt},
			MultiKeyDisabledReason: map[int]string{2: "Daily free limit reached. Try again in 3h 49m"},
		},
	}
	assert.True(t, MultiKeyProbeDeferred(multiKey, 2, now))
	assert.False(t, MultiKeyProbeDeferred(multiKey, 2, bannedAt+5*60*60))
	assert.False(t, MultiKeyProbeDeferred(nil, 2, now))

	disabledChannel := &model.Channel{
		Status: common.ChannelStatusAutoDisabled,
		OtherInfo: `{"status_reason":"Daily free limit reached. Try again in 3h 49m","status_time":` +
			strconv.FormatInt(bannedAt, 10) + `}`,
	}
	assert.True(t, ChannelProbeDeferred(disabledChannel, now))

	enabledChannel := &model.Channel{
		Status:    common.ChannelStatusEnabled,
		OtherInfo: disabledChannel.OtherInfo,
	}
	assert.False(t, ChannelProbeDeferred(enabledChannel, now))
}
