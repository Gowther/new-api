package controller

import (
	"errors"
	"sort"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type modelRoutingOverrideRequest struct {
	Model     string `json:"model"`
	ChannelId int    `json:"channel_id"`
}

type modelRoutingOverrideResponse struct {
	Model       string   `json:"model,omitempty"`
	Models      []string `json:"models"`
	ModelCount  int      `json:"model_count"`
	ChannelId   int      `json:"channel_id"`
	ChannelName string   `json:"channel_name"`
	Groups      []string `json:"groups"`
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
		common.ApiSuccess(c, nil)
		return
	}

	response, err := buildModelRoutingOverrideResponse(overrides)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, response)
}

func SetModelRoutingOverride(c *gin.Context) {
	req := modelRoutingOverrideRequest{}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	overrides, err := model.SetChannelModelRoutingOverride(req.ChannelId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	response, err := buildModelRoutingOverrideResponse(overrides)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "channel.routing_override_set", map[string]interface{}{
		"channel_id":   response.ChannelId,
		"channel_name": response.ChannelName,
		"models":       strings.Join(response.Models, ","),
		"model_count":  response.ModelCount,
		"groups":       strings.Join(response.Groups, ","),
	})
	common.ApiSuccess(c, response)
}

func DeleteModelRoutingOverride(c *gin.Context) {
	deleted, err := model.DeleteAllModelRoutingOverrides()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "channel.routing_override_delete", map[string]interface{}{
		"count": strconv.FormatInt(deleted, 10),
	})
	common.ApiSuccess(c, deleted)
}
