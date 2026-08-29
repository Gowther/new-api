package controller

import (
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type modelRoutingOverrideRequest struct {
	Model string `json:"model"`
	// ReplaceConflicts carries the operator's confirmation that the channels
	// reported by a previous preflight or blocked write may be released.
	ReplaceConflicts bool `json:"replace_conflicts"`
	ChannelId        int  `json:"channel_id"`
}

type modelRoutingOverrideResponse struct {
	Model       string   `json:"model,omitempty"`
	Models      []string `json:"models"`
	ModelCount  int      `json:"model_count"`
	ChannelId   int      `json:"channel_id"`
	ChannelName string   `json:"channel_name"`
	Groups      []string `json:"groups"`
}

func buildModelRoutingOverrideResponses(overrides []model.ModelRoutingOverride) ([]modelRoutingOverrideResponse, error) {
	if len(overrides) == 0 {
		return []modelRoutingOverrideResponse{}, nil
	}

	byChannel := make(map[int][]model.ModelRoutingOverride)
	for _, override := range overrides {
		byChannel[override.ChannelId] = append(byChannel[override.ChannelId], override)
	}
	channelIDs := make([]int, 0, len(byChannel))
	for channelID := range byChannel {
		channelIDs = append(channelIDs, channelID)
	}
	sort.Ints(channelIDs)

	responses := make([]modelRoutingOverrideResponse, 0, len(channelIDs))
	for _, channelID := range channelIDs {
		response, err := buildModelRoutingOverrideResponse(byChannel[channelID])
		if err != nil {
			return nil, err
		}
		responses = append(responses, response)
	}
	return responses, nil
}

func buildModelRoutingOverrideResponse(overrides []model.ModelRoutingOverride) (modelRoutingOverrideResponse, error) {
	if len(overrides) == 0 {
		return modelRoutingOverrideResponse{}, nil
	}

	channelID := overrides[0].ChannelId
	channel, err := model.GetChannelById(channelID, false)
	channelName := ""
	if err == nil {
		channelName = channel.Name
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return modelRoutingOverrideResponse{}, err
	}

	modelSet := make(map[string]struct{})
	groupSet := make(map[string]struct{})
	for _, override := range overrides {
		if override.ChannelId != channelID {
			continue
		}
		modelSet[override.Model] = struct{}{}
		groupSet[override.Group] = struct{}{}
	}
	models := make([]string, 0, len(modelSet))
	for modelName := range modelSet {
		models = append(models, modelName)
	}
	groups := make([]string, 0, len(groupSet))
	for group := range groupSet {
		groups = append(groups, group)
	}
	sort.Strings(models)
	sort.Strings(groups)

	response := modelRoutingOverrideResponse{
		Models:      models,
		ModelCount:  len(models),
		ChannelId:   channelID,
		ChannelName: channelName,
		Groups:      groups,
	}
	if len(models) == 1 {
		response.Model = models[0]
	}
	return response, nil
}

func GetModelRoutingOverride(c *gin.Context) {
	modelName := strings.TrimSpace(c.Query("model"))
	var overrides []model.ModelRoutingOverride
	var err error
	if modelName == "" {
		overrides, err = model.GetAllModelRoutingOverrides()
	} else {
		overrides, err = model.GetModelRoutingOverrides(modelName)
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(overrides) == 0 {
		common.ApiSuccess(c, []modelRoutingOverrideResponse{})
		return
	}

	responses, err := buildModelRoutingOverrideResponses(overrides)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, responses)
}

// GetModelRoutingOverrideConflicts reports which temporary targets enabling a
// channel would release, so the confirmation prompt can name them up front.
func GetModelRoutingOverrideConflicts(c *gin.Context) {
	channelID, err := strconv.Atoi(strings.TrimSpace(c.Query("channel_id")))
	if err != nil || channelID <= 0 {
		common.ApiError(c, errors.New("invalid channel id"))
		return
	}
	conflicts, err := model.PreviewChannelModelRoutingOverrideConflicts(channelID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if conflicts == nil {
		conflicts = []model.ModelRoutingOverrideConflict{}
	}
	common.ApiSuccess(c, conflicts)
}

func SetModelRoutingOverride(c *gin.Context) {
	req := modelRoutingOverrideRequest{}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	result, err := model.SetChannelModelRoutingOverride(req.ChannelId, req.ReplaceConflicts)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	// Conflicts that were not confirmed leave the rules untouched. Report them
	// alongside the message so the client can ask for confirmation instead of
	// only showing a failure, including when a preflight missed a late change.
	if !result.Applied {
		c.JSON(http.StatusOK, gin.H{
			"success":   false,
			"message":   model.ModelRoutingOverrideConflictError(result.Conflicts).Error(),
			"conflicts": result.Conflicts,
		})
		return
	}
	response, err := buildModelRoutingOverrideResponse(result.Overrides)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	releasedChannelIDs := make([]string, 0, len(result.Conflicts))
	for _, conflict := range result.Conflicts {
		releasedChannelIDs = append(releasedChannelIDs, strconv.Itoa(conflict.ChannelId))
	}
	recordManageAudit(c, "channel.routing_override_set", map[string]interface{}{
		"channel_id":        response.ChannelId,
		"channel_name":      response.ChannelName,
		"models":            strings.Join(response.Models, ","),
		"model_count":       response.ModelCount,
		"groups":            strings.Join(response.Groups, ","),
		"released_channels": strings.Join(releasedChannelIDs, ","),
	})
	allOverrides, err := model.GetAllModelRoutingOverrides()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	responses, err := buildModelRoutingOverrideResponses(allOverrides)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, responses)
}

func DeleteModelRoutingOverride(c *gin.Context) {
	channelIDText := strings.TrimSpace(c.Query("channel_id"))
	var deleted int64
	var err error
	if channelIDText == "" {
		deleted, err = model.DeleteAllModelRoutingOverrides()
	} else {
		channelID, parseErr := strconv.Atoi(channelIDText)
		if parseErr != nil || channelID <= 0 {
			common.ApiError(c, errors.New("invalid channel id"))
			return
		}
		deleted, err = model.DeleteModelRoutingOverridesByChannelIDs([]int{channelID})
	}
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "channel.routing_override_delete", map[string]interface{}{
		"count": strconv.FormatInt(deleted, 10),
	})
	allOverrides, err := model.GetAllModelRoutingOverrides()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	responses, err := buildModelRoutingOverrideResponses(allOverrides)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, responses)
}
