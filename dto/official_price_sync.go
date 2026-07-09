package dto

type OfficialPriceMapping struct {
	Source        string `json:"source"`
	Provider      string `json:"provider,omitempty"`
	UpstreamModel string `json:"upstream_model"`
}

type OfficialPriceCandidate struct {
	Source         string         `json:"source"`
	Provider       string         `json:"provider,omitempty"`
	UpstreamModel  string         `json:"upstream_model"`
	Fields         map[string]any `json:"fields"`
	InputPrice     *float64       `json:"input_price,omitempty"`
	OutputPrice    *float64       `json:"output_price,omitempty"`
	CacheReadPrice *float64       `json:"cache_read_price,omitempty"`
	Score          int            `json:"score"`
	Reasons        []string       `json:"reasons"`
	Selected       bool           `json:"selected"`
}

type OfficialPriceModelPreview struct {
	ModelName  string                   `json:"model_name"`
	Current    map[string]any           `json:"current"`
	Mapping    *OfficialPriceMapping    `json:"mapping,omitempty"`
	Candidates []OfficialPriceCandidate `json:"candidates"`
}

type OfficialPriceSourceResult struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
	Count  int    `json:"count,omitempty"`
}

type OfficialPricePreviewData struct {
	Models        []OfficialPriceModelPreview     `json:"models"`
	Mappings      map[string]OfficialPriceMapping `json:"mappings"`
	SourceResults []OfficialPriceSourceResult     `json:"source_results"`
}

type OfficialPriceApplyRequest struct {
	Mappings map[string]OfficialPriceMapping `json:"mappings"`
	ApplyAll bool                            `json:"apply_all"`
}

type OfficialPriceApplyData struct {
	UpdatedModels []string                        `json:"updated_models"`
	SkippedModels []string                        `json:"skipped_models"`
	Mappings      map[string]OfficialPriceMapping `json:"mappings"`
	SourceResults []OfficialPriceSourceResult     `json:"source_results"`
	UpdatedFields map[string]map[string]any       `json:"updated_fields,omitempty"`
}
