package types

// ChannelQuickMappingRule suggests an optional model alias after the channel
// model selection contains a matching upstream model.
type ChannelQuickMappingRule struct {
	MatchMode     string `json:"match_mode"`
	MatchValue    string `json:"match_value"`
	CaseSensitive bool   `json:"case_sensitive"`
	AliasModel    string `json:"alias_model"`
	Enabled       bool   `json:"enabled"`
}
