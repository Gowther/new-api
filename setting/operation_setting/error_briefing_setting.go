package operation_setting

import (
	"strings"

	"github.com/QuantumNous/new-api/setting/config"
)

// ErrorBriefingSetting configures the AI briefing on the error workbench. The
// briefing summarizes already-folded fault problems into something readable, so
// an operator can scan for anything serious instead of opening every cluster.
//
// The briefing runs through this deployment's own channels: Group and Model pick
// the route, so no separate upstream credential is stored here and normal
// routing and failover apply. Everything is off until an admin fills Model in,
// because generating a briefing spends quota and sends error text upstream.
type ErrorBriefingSetting struct {
	Enabled bool   `json:"enabled"`
	Group   string `json:"group"`
	Model   string `json:"model"`
	// IncludeRawErrorText sends the masked upstream error text instead of the
	// fingerprint-normalized form. The normalized form already has URLs, UUIDs,
	// and long tokens replaced with placeholders, which is usually enough to
	// tell faults apart and leaks far less; raw text reads better but is
	// upstream-controlled, so this stays opt-in.
	IncludeRawErrorText bool `json:"include_raw_error_text"`
	CacheMinutes        int  `json:"cache_minutes"`
	MaxProblems         int  `json:"max_problems"`
}

const (
	DefaultErrorBriefingGroup        = "default"
	DefaultErrorBriefingCacheMinutes = 5
	MaxErrorBriefingCacheMinutes     = 120
	// DefaultErrorBriefingMaxProblems bounds how many folded problems reach the
	// prompt. Folding already collapses the long tail, and the briefing is meant
	// to be skimmed, so the cheapest useful cap is a low one.
	DefaultErrorBriefingMaxProblems = 20
	MaxErrorBriefingMaxProblems     = 60
)

var errorBriefingSetting = ErrorBriefingSetting{
	Enabled:             false,
	Group:               DefaultErrorBriefingGroup,
	Model:               "",
	IncludeRawErrorText: false,
	CacheMinutes:        DefaultErrorBriefingCacheMinutes,
	MaxProblems:         DefaultErrorBriefingMaxProblems,
}

func init() {
	config.GlobalConfig.Register("error_briefing_setting", &errorBriefingSetting)
}

func GetErrorBriefingSetting() *ErrorBriefingSetting {
	setting := errorBriefingSetting
	setting.Group = strings.TrimSpace(setting.Group)
	if setting.Group == "" {
		setting.Group = DefaultErrorBriefingGroup
	}
	setting.Model = strings.TrimSpace(setting.Model)
	if setting.CacheMinutes <= 0 {
		setting.CacheMinutes = DefaultErrorBriefingCacheMinutes
	}
	if setting.CacheMinutes > MaxErrorBriefingCacheMinutes {
		setting.CacheMinutes = MaxErrorBriefingCacheMinutes
	}
	if setting.MaxProblems <= 0 {
		setting.MaxProblems = DefaultErrorBriefingMaxProblems
	}
	if setting.MaxProblems > MaxErrorBriefingMaxProblems {
		setting.MaxProblems = MaxErrorBriefingMaxProblems
	}
	return &setting
}

// IsErrorBriefingAvailable reports whether a briefing can actually be generated.
// A missing model is the normal state, not a misconfiguration: the workbench
// keeps working and simply offers no briefing button.
func IsErrorBriefingAvailable() bool {
	setting := GetErrorBriefingSetting()
	return setting.Enabled && setting.Model != ""
}
