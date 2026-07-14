package dto

type ChannelQuickMappingPreviewRequest struct {
	Models       []string `json:"models"`
	ModelMapping string   `json:"model_mapping"`
}

type ChannelQuickMappingSuggestion struct {
	AliasModel      string   `json:"alias_model"`
	MatchMode       string   `json:"match_mode"`
	MatchValue      string   `json:"match_value"`
	CandidateModels []string `json:"candidate_models"`
}

type ChannelQuickMappingPreview struct {
	Suggestions []ChannelQuickMappingSuggestion `json:"suggestions"`
}
