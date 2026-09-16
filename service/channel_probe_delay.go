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
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

// Probing a channel (or one of its keys) while the upstream is still rate
// limited only burns a test request and reports the same failure, so the
// error text an auto-ban leaves behind is used as a hint: if it names a
// reset time, recovery probing waits until then. The parse covers the
// common vendored notices — relative durations like "Try again in 3h 49m"
// and datetimes like "Resets at 2026-09-17 08:30:00" — and stays a hint:
// whatever it cannot read falls back to the normal test interval.
const (
	// A parsed hint below this floor is not worth acting on; the normal
	// interval probe would come within minutes anyway.
	MinProbeDelay = time.Minute
	// Upstream hints are cut down to this horizon so a bogus or misread value
	// cannot park a channel for weeks.
	MaxProbeDelay = 7 * 24 * time.Hour
)

// Retry-style anchor before a relative duration, so numbers elsewhere in the
// error ("Error 429: ...") are not misread.
var probeDurationAnchorRegex = regexp.MustCompile(
	`(?i)(?:try again|retry|please wait|resets?|reopens?|available|重试|再试|请于|请在)[^.\n\d]{0,24}`)

var probeDurationTokenRegex = regexp.MustCompile(
	`(?i)(\d+(?:\.\d+)?)\s*(days?|hours?|hrs?|minutes?|mins?|seconds?|secs?|天|小时|分钟|[dhms]|分|时|秒)`)

var probeDateTimeRegex = regexp.MustCompile(
	`(\d{4}[-/]\d{1,2}[-/]\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d{1,6})?(?:\s?[Zz]|[+-]\d{2}:?\d{2})?)?`)

var probeDateTimeLayouts = []string{
	time.RFC3339Nano,
	time.RFC3339,
	"2006-01-02T15:04:05",
	"2006-01-02T15:04",
	"2006-01-02 15:04:05",
	"2006-01-02 15:04",
	"2006-01-02",
	"2006/01/02 15:04:05",
	"2006/01/02 15:04",
	"2006/01/02",
}

var probeDurationUnits = map[string]time.Duration{
	"d":       24 * time.Hour,
	"day":     24 * time.Hour,
	"days":    24 * time.Hour,
	"h":       time.Hour,
	"hr":      time.Hour,
	"hrs":     time.Hour,
	"hour":    time.Hour,
	"hours":   time.Hour,
	"m":       time.Minute,
	"min":     time.Minute,
	"mins":    time.Minute,
	"minute":  time.Minute,
	"minutes": time.Minute,
	"s":       time.Second,
	"sec":     time.Second,
	"secs":    time.Second,
	"second":  time.Second,
	"seconds": time.Second,
	"天":       24 * time.Hour,
	"小时":      time.Hour,
	"时":       time.Hour,
	"分钟":      time.Minute,
	"分":       time.Minute,
	"秒":       time.Second,
}

// Clamps a parsed hint into the actionable window; a hint in the past is no
// deferral at all, not a probe skip.
func clampProbeDelay(delay time.Duration) (time.Duration, bool) {
	if delay <= 0 {
		return 0, false
	}
	if delay < MinProbeDelay {
		delay = MinProbeDelay
	}
	if delay > MaxProbeDelay {
		delay = MaxProbeDelay
	}
	return delay, true
}

func parseProbeDurationHint(text string) (time.Duration, bool) {
	anchor := probeDurationAnchorRegex.FindStringIndex(text)
	if anchor == nil {
		return 0, false
	}
	// The hint lives on the anchor's line; a later sentence may name anything.
	segment := text[anchor[0]:]
	if end := strings.IndexAny(segment, ".。\n"); end >= 0 {
		segment = segment[:end]
	}
	var delay time.Duration
	for _, token := range probeDurationTokenRegex.FindAllStringSubmatch(segment, -1) {
		value, err := strconv.ParseFloat(token[1], 64)
		if err != nil {
			continue
		}
		unit, ok := probeDurationUnits[strings.ToLower(strings.TrimSpace(token[2]))]
		if !ok {
			continue
		}
		delay += time.Duration(value * float64(unit))
	}
	if delay > 0 {
		return delay, true
	}
	// 中文提示没有严格的 "in/after" 锚点；出现重试类词时在整个文案里取时长。
	if strings.Contains(text, "重试") || strings.Contains(text, "再试") {
		for _, token := range probeDurationTokenRegex.FindAllStringSubmatch(text, -1) {
			value, err := strconv.ParseFloat(token[1], 64)
			if err != nil {
				continue
			}
			if unit, ok := probeDurationUnits[token[2]]; ok {
				delay += time.Duration(value * float64(unit))
			}
		}
	}
	if delay > 0 {
		return delay, true
	}
	return 0, false
}

// probeDateTimeAnchored checks whether the text just before a timestamp names
// a reset — an authoritative hint beats any bare timestamp in the body.
func probeDateTimeAnchored(text string, start int) bool {
	windowStart := start - 32
	if windowStart < 0 {
		windowStart = 0
	}
	window := strings.ToLower(text[windowStart:start])
	for _, keyword := range []string{"reset", "available", "reopen", "again"} {
		if strings.Contains(window, keyword) {
			return true
		}
	}
	return false
}

func parseResetDateTimeHint(text string) (time.Time, bool) {
	matches := probeDateTimeRegex.FindAllString(text, -1)
	if len(matches) == 0 {
		return time.Time{}, false
	}
	anchored := make([]string, 0, len(matches))
	var plain []string
	cursor := 0
	for _, match := range matches {
		start := strings.Index(text[cursor:], match)
		if start < 0 {
			continue
		}
		start += cursor
		cursor = start + len(match)
		if probeDateTimeAnchored(text, start) {
			anchored = append(anchored, match)
		} else {
			plain = append(plain, match)
		}
	}
	for _, candidate := range append(anchored, plain...) {
		for _, layout := range probeDateTimeLayouts {
			if resetAt, err := time.ParseInLocation(layout, strings.TrimSpace(candidate), time.Local); err == nil {
				return resetAt, true
			}
		}
	}
	return time.Time{}, false
}

// parseProbeDelayForNotify reads the delay a disable notification should
// advertise, or reports false when the text carries no usable reset hint.
func parseProbeDelayForNotify(text string) (time.Duration, bool) {
	if strings.TrimSpace(text) == "" {
		return 0, false
	}
	if resetAt, ok := parseResetDateTimeHint(text); ok {
		return clampProbeDelay(resetAt.Sub(time.Now()))
	}
	if delay, ok := parseProbeDurationHint(text); ok {
		return clampProbeDelay(delay)
	}
	return 0, false
}

// ChannelProbeNoBefore reports the earliest Unix time a disabled channel or
// key may be probed again, derived from the reset hint inside the disable
// reason recorded at disabledAt. A datetime hint stands on its own; a
// relative one is measured from the moment the reason was recorded. 0 means
// probe on the normal cadence now.
func ChannelProbeNoBefore(reason string, disabledAt int64, now int64) int64 {
	if disabledAt <= 0 || now <= 0 {
		return 0
	}
	if strings.TrimSpace(reason) == "" {
		return 0
	}
	var noBefore int64
	if resetAt, ok := parseResetDateTimeHint(reason); ok {
		if !resetAt.After(time.Unix(now, 0)) {
			return 0
		}
		noBefore = resetAt.Unix()
		if now+int64(MaxProbeDelay/time.Second) < noBefore {
			noBefore = now + int64(MaxProbeDelay/time.Second)
		}
	} else if delay, ok := parseProbeDurationHint(reason); ok {
		clamped, ok := clampProbeDelay(delay)
		if !ok {
			return 0
		}
		noBefore = disabledAt + int64((clamped+time.Second-1)/time.Second)
	} else {
		return 0
	}
	if noBefore <= now {
		return 0
	}
	return noBefore
}

// MultiKeyProbeDeferred reports whether an auto-disabled key of a multi-key
// channel holds off probes because its recorded disable reason names a future
// reset time.
func MultiKeyProbeDeferred(channel *model.Channel, keyIndex int, now int64) bool {
	if channel == nil {
		return false
	}
	reason := ""
	if channel.ChannelInfo.MultiKeyDisabledReason != nil {
		reason = channel.ChannelInfo.MultiKeyDisabledReason[keyIndex]
	}
	disabledAt := int64(0)
	if channel.ChannelInfo.MultiKeyDisabledTime != nil {
		disabledAt = channel.ChannelInfo.MultiKeyDisabledTime[keyIndex]
	}
	return ChannelProbeNoBefore(reason, disabledAt, now) > now
}

// ChannelProbeDeferred reports the same deferral for a channel-level auto
// disable, whose reason lives in other_info.
func ChannelProbeDeferred(channel *model.Channel, now int64) bool {
	if channel == nil || channel.Status != common.ChannelStatusAutoDisabled {
		return false
	}
	info := channel.GetOtherInfo()
	statusReason, _ := info["status_reason"].(string)
	statusTime, _ := info["status_time"].(float64)
	return ChannelProbeNoBefore(statusReason, int64(statusTime), now) > now
}

// humanizeProbeDelay renders a deferral for the root-user notification.
func humanizeProbeDelay(delay time.Duration) string {
	if delay < time.Minute {
		return "1 分钟内"
	}
	delay = delay.Round(time.Minute)
	days := int(delay / (24 * time.Hour))
	hours := int((delay % (24 * time.Hour)) / time.Hour)
	minutes := int((delay % time.Hour) / time.Minute)
	hint := ""
	if days > 0 {
		hint += fmt.Sprintf("%d天", days)
	}
	if hours > 0 {
		hint += fmt.Sprintf("%d小时", hours)
	}
	if minutes > 0 || hint == "" {
		hint += fmt.Sprintf("%d分钟", minutes)
	}
	return hint
}
