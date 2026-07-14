package dto

import "github.com/QuantumNous/new-api/types"

const (
	ChannelModelMappingChangeApplied  = "applied"
	ChannelModelMappingChangeConflict = "conflict"

	ChannelModelMappingConflictExistingMapping = "existing_mapping"
	ChannelModelMappingConflictMultipleTargets = "multiple_targets"
)

type ChannelModelMappingPreviewRequest struct {
	Models       []string                         `json:"models"`
	ModelMapping string                           `json:"model_mapping"`
	Rules        *[]types.ChannelModelMappingRule `json:"rules,omitempty"`
}

type ChannelModelMappingPreviewChange struct {
	UpstreamModel    string   `json:"upstream_model"`
	ExposedModel     string   `json:"exposed_model"`
	MatchMode        string   `json:"match_mode"`
	MatchValue       string   `json:"match_value"`
	Status           string   `json:"status"`
	ConflictType     string   `json:"conflict_type,omitempty"`
	ExistingTarget   string   `json:"existing_target,omitempty"`
	CandidateTargets []string `json:"candidate_targets,omitempty"`
}

type ChannelModelMappingPreview struct {
	Models        []string                           `json:"models"`
	ModelMapping  map[string]string                  `json:"model_mapping"`
	RemovedModels []string                           `json:"removed_models"`
	AddedModels   []string                           `json:"added_models"`
	Changes       []ChannelModelMappingPreviewChange `json:"changes"`
	HasChanges    bool                               `json:"has_changes"`
	HasConflicts  bool                               `json:"has_conflicts"`
}
