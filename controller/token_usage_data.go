package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

const defaultTokenUsageRangeSeconds = 7 * 24 * 3600
const defaultTokenUsageDetailLimit = 200
const maxTokenUsageDetailLimit = 1000

func GetTokenUsageSelf(c *gin.Context) {
	userId := c.GetInt("id")
	now := common.GetTimestamp()
	startTimestamp, ok := parseOptionalInt64Query(c, "start_timestamp")
	if !ok {
		return
	}
	endTimestamp, ok := parseOptionalInt64Query(c, "end_timestamp")
	if !ok {
		return
	}
	if endTimestamp == 0 {
		endTimestamp = now
	}
	if startTimestamp == 0 {
		startTimestamp = endTimestamp - defaultTokenUsageRangeSeconds
	}
	if endTimestamp < startTimestamp {
		common.ApiErrorMsg(c, "end_timestamp must be greater than or equal to start_timestamp")
		return
	}

	tokenId, ok := parseOptionalIntQuery(c, "token_id")
	if !ok {
		return
	}
	detailLimit, ok := parseOptionalIntQuery(c, "detail_limit")
	if !ok {
		return
	}
	if detailLimit <= 0 {
		detailLimit = defaultTokenUsageDetailLimit
	}
	if detailLimit > maxTokenUsageDetailLimit {
		detailLimit = maxTokenUsageDetailLimit
	}

	resp, err := model.GetTokenUsageSelf(userId, model.TokenUsageQuery{
		StartTimestamp: startTimestamp,
		EndTimestamp:   endTimestamp,
		TokenID:        tokenId,
		ModelName:      c.Query("model_name"),
		Granularity:    c.DefaultQuery("granularity", "day"),
		DetailLimit:    detailLimit,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, resp)
}

func parseOptionalInt64Query(c *gin.Context, key string) (int64, bool) {
	raw := c.Query(key)
	if raw == "" {
		return 0, true
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		common.ApiErrorMsg(c, "invalid "+key)
		return 0, false
	}
	return value, true
}

func parseOptionalIntQuery(c *gin.Context, key string) (int, bool) {
	raw := c.Query(key)
	if raw == "" {
		return 0, true
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		common.ApiErrorMsg(c, "invalid "+key)
		return 0, false
	}
	return value, true
}
