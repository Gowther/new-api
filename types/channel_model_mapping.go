package types

const (
	ChannelModelMatchModeExact    = "exact"
	ChannelModelMatchModeContains = "contains"
)

type ChannelModelMappingRule struct {
	MatchMode     string `json:"match_mode"`
	MatchValue    string `json:"match_value"`
	CaseSensitive bool   `json:"case_sensitive"`
	ExposedModel  string `json:"exposed_model"`
	Priority      int    `json:"priority"`
	Enabled       bool   `json:"enabled"`
}
