package model

import (
	"fmt"
	"sort"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type TokenUsageData struct {
	Id               int    `json:"id"`
	UserID           int    `json:"user_id" gorm:"index:idx_tud_user_created,priority:1;uniqueIndex:idx_tud_unique,priority:1"`
	Username         string `json:"username" gorm:"size:64;default:''"`
	TokenID          int    `json:"token_id" gorm:"index:idx_tud_token,priority:1;uniqueIndex:idx_tud_unique,priority:2"`
	TokenName        string `json:"token_name" gorm:"size:128;default:''"`
	ModelName        string `json:"model_name" gorm:"size:128;index:idx_tud_model,priority:1;uniqueIndex:idx_tud_unique,priority:3"`
	CreatedAt        int64  `json:"created_at" gorm:"bigint;index:idx_tud_user_created,priority:2;uniqueIndex:idx_tud_unique,priority:4"`
	Count            int64  `json:"count" gorm:"default:0"`
	Quota            int64  `json:"quota" gorm:"default:0"`
	PromptTokens     int64  `json:"prompt_tokens" gorm:"default:0"`
	CompletionTokens int64  `json:"completion_tokens" gorm:"default:0"`
	TotalTokens      int64  `json:"total_tokens" gorm:"default:0"`
	LastUsedAt       int64  `json:"last_used_at" gorm:"bigint;index"`
}

func (TokenUsageData) TableName() string {
	return "token_usage_data"
}

type TokenUsageQuery struct {
	StartTimestamp int64
	EndTimestamp   int64
	TokenID        int
	ModelName      string
	Granularity    string
	DetailLimit    int
}

type TokenUsageSummary struct {
	TotalRequests         int64 `json:"total_requests"`
	TotalQuota            int64 `json:"total_quota"`
	TotalPromptTokens     int64 `json:"total_prompt_tokens"`
	TotalCompletionTokens int64 `json:"total_completion_tokens"`
	TotalTokens           int64 `json:"total_tokens"`
	ApiKeyCount           int64 `json:"api_key_count"`
	ModelCount            int64 `json:"model_count"`
}

type TokenUsageTrendItem struct {
	Timestamp        int64 `json:"timestamp"`
	Count            int64 `json:"count"`
	Quota            int64 `json:"quota"`
	PromptTokens     int64 `json:"prompt_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
	TotalTokens      int64 `json:"total_tokens"`
}

type TokenUsageTokenItem struct {
	TokenID          int    `json:"token_id"`
	TokenName        string `json:"token_name"`
	Count            int64  `json:"count"`
	Quota            int64  `json:"quota"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	LastUsedAt       int64  `json:"last_used_at"`
}

type TokenUsageModelItem struct {
	ModelName        string `json:"model_name"`
	Count            int64  `json:"count"`
	Quota            int64  `json:"quota"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	LastUsedAt       int64  `json:"last_used_at"`
}

type TokenUsageDetailItem struct {
	CreatedAt        int64  `json:"created_at"`
	TokenID          int    `json:"token_id"`
	TokenName        string `json:"token_name"`
	ModelName        string `json:"model_name"`
	Count            int64  `json:"count"`
	Quota            int64  `json:"quota"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	LastUsedAt       int64  `json:"last_used_at"`
}

type TokenUsageSelfResponse struct {
	Summary TokenUsageSummary      `json:"summary"`
	Trend   []TokenUsageTrendItem  `json:"trend"`
	ByToken []TokenUsageTokenItem  `json:"by_token"`
	ByModel []TokenUsageModelItem  `json:"by_model"`
	Rows    []TokenUsageDetailItem `json:"rows"`
}

func RecordTokenUsageData(userId int, username string, params RecordConsumeLogParams, createdAt int64) error {
	if userId <= 0 || params.TokenId <= 0 {
		return nil
	}
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	if createdAt <= 0 {
		createdAt = common.GetTimestamp()
	}

	bucket := createdAt - createdAt%3600
	promptTokens := int64(params.PromptTokens)
	completionTokens := int64(params.CompletionTokens)
	totalTokens := promptTokens + completionTokens
	row := &TokenUsageData{
		UserID:           userId,
		Username:         username,
		TokenID:          params.TokenId,
		TokenName:        params.TokenName,
		ModelName:        params.ModelName,
		CreatedAt:        bucket,
		Count:            1,
		Quota:            int64(params.Quota),
		PromptTokens:     promptTokens,
		CompletionTokens: completionTokens,
		TotalTokens:      totalTokens,
		LastUsedAt:       createdAt,
	}

	return DB.Clauses(clause.OnConflict{
		Columns: []clause.Column{
			{Name: "user_id"},
			{Name: "token_id"},
			{Name: "model_name"},
			{Name: "created_at"},
		},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"username":          username,
			"token_name":        params.TokenName,
			"count":             gorm.Expr("count + ?", 1),
			"quota":             gorm.Expr("quota + ?", params.Quota),
			"prompt_tokens":     gorm.Expr("prompt_tokens + ?", params.PromptTokens),
			"completion_tokens": gorm.Expr("completion_tokens + ?", params.CompletionTokens),
			"total_tokens":      gorm.Expr("total_tokens + ?", totalTokens),
			"last_used_at":      tokenUsageLastUsedExpr(createdAt),
		}),
	}).Create(row).Error
}

func GetTokenUsageSelf(userId int, query TokenUsageQuery) (*TokenUsageSelfResponse, error) {
	if userId <= 0 {
		return nil, fmt.Errorf("invalid user id")
	}
	if DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	if query.StartTimestamp > 0 && query.EndTimestamp > 0 && query.EndTimestamp < query.StartTimestamp {
		return nil, fmt.Errorf("end timestamp must be greater than or equal to start timestamp")
	}

	db := DB.Model(&TokenUsageData{}).Where("user_id = ?", userId)
	if query.StartTimestamp > 0 {
		db = db.Where("created_at >= ?", query.StartTimestamp)
	}
	if query.EndTimestamp > 0 {
		db = db.Where("created_at <= ?", query.EndTimestamp)
	}
	if query.TokenID > 0 {
		db = db.Where("token_id = ?", query.TokenID)
	}
	if query.ModelName != "" {
		db = db.Where("model_name = ?", query.ModelName)
	}

	var rows []TokenUsageData
	if err := db.Order("created_at desc, quota desc, id desc").Find(&rows).Error; err != nil {
		return nil, err
	}

	return buildTokenUsageSelfResponse(rows, normalizeTokenUsageGranularity(query.Granularity), query.DetailLimit), nil
}

func buildTokenUsageSelfResponse(rows []TokenUsageData, granularity string, detailLimit int) *TokenUsageSelfResponse {
	resp := &TokenUsageSelfResponse{
		Trend:   make([]TokenUsageTrendItem, 0),
		ByToken: make([]TokenUsageTokenItem, 0),
		ByModel: make([]TokenUsageModelItem, 0),
		Rows:    make([]TokenUsageDetailItem, 0, len(rows)),
	}

	tokenMap := make(map[int]*TokenUsageTokenItem)
	modelMap := make(map[string]*TokenUsageModelItem)
	trendMap := make(map[int64]*TokenUsageTrendItem)
	tokenIDs := make(map[int]struct{})
	modelNames := make(map[string]struct{})

	for _, row := range rows {
		resp.Summary.TotalRequests += row.Count
		resp.Summary.TotalQuota += row.Quota
		resp.Summary.TotalPromptTokens += row.PromptTokens
		resp.Summary.TotalCompletionTokens += row.CompletionTokens
		resp.Summary.TotalTokens += row.TotalTokens
		tokenIDs[row.TokenID] = struct{}{}
		modelNames[row.ModelName] = struct{}{}

		bucket := tokenUsageTrendBucket(row.CreatedAt, granularity)
		trend, ok := trendMap[bucket]
		if !ok {
			trend = &TokenUsageTrendItem{Timestamp: bucket}
			trendMap[bucket] = trend
		}
		addTokenUsageMetrics(&trend.Count, &trend.Quota, &trend.PromptTokens, &trend.CompletionTokens, &trend.TotalTokens, row)

		tokenItem, ok := tokenMap[row.TokenID]
		if !ok {
			tokenItem = &TokenUsageTokenItem{
				TokenID:   row.TokenID,
				TokenName: row.TokenName,
			}
			tokenMap[row.TokenID] = tokenItem
		}
		if row.LastUsedAt >= tokenItem.LastUsedAt {
			tokenItem.TokenName = row.TokenName
			tokenItem.LastUsedAt = row.LastUsedAt
		}
		addTokenUsageMetrics(&tokenItem.Count, &tokenItem.Quota, &tokenItem.PromptTokens, &tokenItem.CompletionTokens, &tokenItem.TotalTokens, row)

		modelName := row.ModelName
		modelItem, ok := modelMap[modelName]
		if !ok {
			modelItem = &TokenUsageModelItem{ModelName: modelName}
			modelMap[modelName] = modelItem
		}
		if row.LastUsedAt > modelItem.LastUsedAt {
			modelItem.LastUsedAt = row.LastUsedAt
		}
		addTokenUsageMetrics(&modelItem.Count, &modelItem.Quota, &modelItem.PromptTokens, &modelItem.CompletionTokens, &modelItem.TotalTokens, row)

		resp.Rows = append(resp.Rows, TokenUsageDetailItem{
			CreatedAt:        row.CreatedAt,
			TokenID:          row.TokenID,
			TokenName:        row.TokenName,
			ModelName:        row.ModelName,
			Count:            row.Count,
			Quota:            row.Quota,
			PromptTokens:     row.PromptTokens,
			CompletionTokens: row.CompletionTokens,
			TotalTokens:      row.TotalTokens,
			LastUsedAt:       row.LastUsedAt,
		})
	}

	resp.Summary.ApiKeyCount = int64(len(tokenIDs))
	resp.Summary.ModelCount = int64(len(modelNames))

	for _, item := range trendMap {
		resp.Trend = append(resp.Trend, *item)
	}
	sort.Slice(resp.Trend, func(i, j int) bool {
		return resp.Trend[i].Timestamp < resp.Trend[j].Timestamp
	})

	for _, item := range tokenMap {
		resp.ByToken = append(resp.ByToken, *item)
	}
	sort.Slice(resp.ByToken, func(i, j int) bool {
		return tokenUsageRankLess(resp.ByToken[i].Quota, resp.ByToken[j].Quota, resp.ByToken[i].TotalTokens, resp.ByToken[j].TotalTokens, resp.ByToken[i].Count, resp.ByToken[j].Count)
	})

	for _, item := range modelMap {
		resp.ByModel = append(resp.ByModel, *item)
	}
	sort.Slice(resp.ByModel, func(i, j int) bool {
		return tokenUsageRankLess(resp.ByModel[i].Quota, resp.ByModel[j].Quota, resp.ByModel[i].TotalTokens, resp.ByModel[j].TotalTokens, resp.ByModel[i].Count, resp.ByModel[j].Count)
	})

	sort.Slice(resp.Rows, func(i, j int) bool {
		if resp.Rows[i].CreatedAt == resp.Rows[j].CreatedAt {
			return resp.Rows[i].Quota > resp.Rows[j].Quota
		}
		return resp.Rows[i].CreatedAt > resp.Rows[j].CreatedAt
	})
	if detailLimit > 0 && len(resp.Rows) > detailLimit {
		resp.Rows = resp.Rows[:detailLimit]
	}

	return resp
}

func addTokenUsageMetrics(count *int64, quota *int64, promptTokens *int64, completionTokens *int64, totalTokens *int64, row TokenUsageData) {
	*count += row.Count
	*quota += row.Quota
	*promptTokens += row.PromptTokens
	*completionTokens += row.CompletionTokens
	*totalTokens += row.TotalTokens
}

func tokenUsageRankLess(leftQuota int64, rightQuota int64, leftTokens int64, rightTokens int64, leftCount int64, rightCount int64) bool {
	if leftQuota != rightQuota {
		return leftQuota > rightQuota
	}
	if leftTokens != rightTokens {
		return leftTokens > rightTokens
	}
	return leftCount > rightCount
}

func normalizeTokenUsageGranularity(granularity string) string {
	if granularity == "hour" {
		return "hour"
	}
	return "day"
}

func tokenUsageTrendBucket(timestamp int64, granularity string) int64 {
	if granularity == "hour" {
		return timestamp - timestamp%3600
	}
	t := time.Unix(timestamp, 0)
	year, month, day := t.Date()
	return time.Date(year, month, day, 0, 0, 0, 0, t.Location()).Unix()
}

func tokenUsageLastUsedExpr(timestamp int64) clause.Expr {
	if common.UsingMySQL || common.UsingPostgreSQL {
		return gorm.Expr("GREATEST(last_used_at, ?)", timestamp)
	}
	return gorm.Expr("MAX(last_used_at, ?)", timestamp)
}
