package controller

import (
	"errors"
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
	Model       string   `json:"model"`
	ChannelId   int      `json:"channel_id"`
	ChannelName string   `json:"channel_name"`
	Groups      []string `json:"groups"`
}

func GetModelRoutingOverride(c *gin.Context) {
	modelName := strings.TrimSpace(c.Query("model"))
	if modelName == "" {
		common.ApiErrorMsg(c, "model is required")
		return
	}

	overrides, err := model.GetModelRoutingOverrides(modelName)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(overrides) == 0 {
		common.ApiSuccess(c, nil)
		return
	}

	channelID := overrides[0].ChannelId
	channel, err := model.GetChannelById(channelID, false)
	channelName := ""
	if err == nil {
		channelName = channel.Name
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		common.ApiError(c, err)
		return
	}
	groups := make([]string, 0, len(overrides))
	for _, override := range overrides {
		groups = append(groups, override.Group)
	}
	common.ApiSuccess(c, modelRoutingOverrideResponse{
		Model:       overrides[0].Model,
		ChannelId:   channelID,
		ChannelName: channelName,
		Groups:      groups,
	})
}

func SetModelRoutingOverride(c *gin.Context) {
	req := modelRoutingOverrideRequest{}
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiError(c, err)
		return
	}
	req.Model = strings.TrimSpace(req.Model)
	overrides, err := model.SetModelRoutingOverride(req.Model, req.ChannelId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	channel, err := model.GetChannelById(req.ChannelId, false)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	groups := make([]string, 0, len(overrides))
	for _, override := range overrides {
		groups = append(groups, override.Group)
	}
	response := modelRoutingOverrideResponse{
		Model:       overrides[0].Model,
		ChannelId:   req.ChannelId,
		ChannelName: channel.Name,
		Groups:      groups,
	}
	recordManageAudit(c, "channel.routing_override_set", map[string]interface{}{
		"model":        response.Model,
		"channel_id":   response.ChannelId,
		"channel_name": response.ChannelName,
		"groups":       strings.Join(response.Groups, ","),
	})
	common.ApiSuccess(c, response)
}

func DeleteModelRoutingOverride(c *gin.Context) {
	modelName := strings.TrimSpace(c.Query("model"))
	if modelName == "" {
		common.ApiErrorMsg(c, "model is required")
		return
	}
	deleted, err := model.DeleteModelRoutingOverride(modelName)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "channel.routing_override_delete", map[string]interface{}{
		"model": modelName,
		"count": strconv.FormatInt(deleted, 10),
	})
	common.ApiSuccess(c, deleted)
}
