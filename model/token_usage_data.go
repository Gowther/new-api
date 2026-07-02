package model

import (
	"fmt"
	"sort"
	"strconv"
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
	CacheReadTokens  int64  `json:"cache_read_tokens" gorm:"default:0"`
	CacheWriteTokens int64  `json:"cache_write_tokens" gorm:"default:0"`
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
	TotalCacheReadTokens  int64 `json:"total_cache_read_tokens"`
	TotalCacheWriteTokens int64 `json:"total_cache_write_tokens"`
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
	CacheReadTokens  int64 `json:"cache_read_tokens"`
	CacheWriteTokens int64 `json:"cache_write_tokens"`
}

type TokenUsageTokenItem struct {
	TokenID          int    `json:"token_id"`
	TokenName        string `json:"token_name"`
	Count            int64  `json:"count"`
	Quota            int64  `json:"quota"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	CacheReadTokens  int64  `json:"cache_read_tokens"`
	CacheWriteTokens int64  `json:"cache_write_tokens"`
	LastUsedAt       int64  `json:"last_used_at"`
}

type TokenUsageModelItem struct {
	ModelName        string `json:"model_name"`
	Count            int64  `json:"count"`
	Quota            int64  `json:"quota"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	TotalTokens      int64  `json:"total_tokens"`
	CacheReadTokens  int64  `json:"cache_read_tokens"`
	CacheWriteTokens int64  `json:"cache_write_tokens"`
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
	CacheReadTokens  int64  `json:"cache_read_tokens"`
	CacheWriteTokens int64  `json:"cache_write_tokens"`
	LastUsedAt       int64  `json:"last_used_at"`
}

type TokenUsageSelfResponse struct {
	Summary TokenUsageSummary      `json:"summary"`
	Trend   []TokenUsageTrendItem  `json:"trend"`
	ByToken []TokenUsageTokenItem  `json:"by_token"`
	ByModel []TokenUsageModelItem  `json:"by_model"`
	Rows    []TokenUsageDetailItem `json:"rows"`
}

const tokenUsageBackfillOptionKey = "TokenUsageBackfill90dV5CompletedAt"
const tokenUsageBackfillBatchSize = 1000

type tokenUsageBackfillResult struct {
	Logs           int
	Rows           int
	StartTimestamp int64
	EndTimestamp   int64
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
	cacheReadTokens, cacheWriteTokens := tokenUsageCacheTokensFromOther(params.Other)
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
		CacheReadTokens:  cacheReadTokens,
		CacheWriteTokens: cacheWriteTokens,
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
			"username":           username,
			"token_name":         params.TokenName,
			"count":              tokenUsageAddExpr("count", 1),
			"quota":              tokenUsageAddExpr("quota", params.Quota),
			"prompt_tokens":      tokenUsageAddExpr("prompt_tokens", params.PromptTokens),
			"completion_tokens":  tokenUsageAddExpr("completion_tokens", params.CompletionTokens),
			"total_tokens":       tokenUsageAddExpr("total_tokens", totalTokens),
			"cache_read_tokens":  tokenUsageAddExpr("cache_read_tokens", cacheReadTokens),
			"cache_write_tokens": tokenUsageAddExpr("cache_write_tokens", cacheWriteTokens),
			"last_used_at":       tokenUsageLastUsedExpr(createdAt),
		}),
	}).Create(row).Error
}

func BackfillRecentTokenUsageDataFromLogsIfNeeded(days int) error {
	if !common.IsMasterNode {
		return nil
	}
	if tokenUsageBackfillCompleted() {
		return nil
	}
	if days <= 0 {
		days = 90
	}

	common.SysLog(fmt.Sprintf("token usage data backfill started, range=%d days", days))
	result, err := backfillTokenUsageDataFromLogs(days, common.GetTimestamp())
	if err != nil {
		return err
	}
	if err := UpdateOption(tokenUsageBackfillOptionKey, fmt.Sprintf("%d", common.GetTimestamp())); err != nil {
		return err
	}
	common.SysLog(fmt.Sprintf(
		"token usage data backfill completed, logs=%d rows=%d start=%d end=%d",
		result.Logs,
		result.Rows,
		result.StartTimestamp,
		result.EndTimestamp,
	))
	return nil
}

func tokenUsageBackfillCompleted() bool {
	common.OptionMapRWMutex.RLock()
	defer common.OptionMapRWMutex.RUnlock()
	if common.OptionMap == nil {
		return false
	}
	return common.OptionMap[tokenUsageBackfillOptionKey] != ""
}

type tokenUsageAggregateKey struct {
	UserID    int
	TokenID   int
	ModelName string
	CreatedAt int64
}

func backfillTokenUsageDataFromLogs(days int, now int64) (*tokenUsageBackfillResult, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	if LOG_DB == nil {
		return nil, fmt.Errorf("log database not initialized")
	}
	if days <= 0 {
		return nil, fmt.Errorf("days must be greater than 0")
	}

	endExclusive := now - now%3600
	if endExclusive <= 0 {
		return &tokenUsageBackfillResult{}, nil
	}
	startTimestamp := endExclusive - int64(days)*24*3600
	if startTimestamp < 0 {
		startTimestamp = 0
	}

	result := &tokenUsageBackfillResult{
		StartTimestamp: startTimestamp,
		EndTimestamp:   endExclusive - 1,
	}
	aggregate := make(map[tokenUsageAggregateKey]*TokenUsageData)

	var logs []Log
	err := LOG_DB.Model(&Log{}).
		Select("id, user_id, username, token_id, token_name, model_name, created_at, quota, prompt_tokens, completion_tokens, other").
		Where("type = ? and token_id > ? and created_at >= ? and created_at < ?", LogTypeConsume, 0, startTimestamp, endExclusive).
		Order("id asc").
		FindInBatches(&logs, tokenUsageBackfillBatchSize, func(tx *gorm.DB, batch int) error {
			result.Logs += len(logs)
			for _, log := range logs {
				if log.UserId <= 0 || log.TokenId <= 0 {
					continue
				}
				bucket := log.CreatedAt - log.CreatedAt%3600
				if bucket < startTimestamp || bucket >= endExclusive {
					continue
				}
				key := tokenUsageAggregateKey{
					UserID:    log.UserId,
					TokenID:   log.TokenId,
					ModelName: log.ModelName,
					CreatedAt: bucket,
				}
				row, ok := aggregate[key]
				if !ok {
					row = &TokenUsageData{
						UserID:    log.UserId,
						TokenID:   log.TokenId,
						ModelName: log.ModelName,
						CreatedAt: bucket,
					}
					aggregate[key] = row
				}
				row.Count++
				row.Quota += int64(log.Quota)
				row.PromptTokens += int64(log.PromptTokens)
				row.CompletionTokens += int64(log.CompletionTokens)
				row.TotalTokens += int64(log.PromptTokens + log.CompletionTokens)
				otherMap, _ := common.StrToMap(log.Other)
				cacheReadTokens, cacheWriteTokens := tokenUsageCacheTokensFromOther(otherMap)
				row.CacheReadTokens += cacheReadTokens
				row.CacheWriteTokens += cacheWriteTokens
				if log.CreatedAt >= row.LastUsedAt {
					row.Username = log.Username
					row.TokenName = log.TokenName
					row.LastUsedAt = log.CreatedAt
				}
			}
			return nil
		}).Error
	if err != nil {
		return nil, err
	}

	rows := make([]TokenUsageData, 0, len(aggregate))
	for _, row := range aggregate {
		rows = append(rows, *row)
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].CreatedAt != rows[j].CreatedAt {
			return rows[i].CreatedAt < rows[j].CreatedAt
		}
		if rows[i].UserID != rows[j].UserID {
			return rows[i].UserID < rows[j].UserID
		}
		if rows[i].TokenID != rows[j].TokenID {
			return rows[i].TokenID < rows[j].TokenID
		}
		return rows[i].ModelName < rows[j].ModelName
	})
	result.Rows = len(rows)

	err = DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("created_at >= ? and created_at < ?", startTimestamp, endExclusive).Delete(&TokenUsageData{}).Error; err != nil {
			return err
		}
		for start := 0; start < len(rows); start += tokenUsageBackfillBatchSize {
			end := start + tokenUsageBackfillBatchSize
			if end > len(rows) {
				end = len(rows)
			}
			chunk := rows[start:end]
			if err := tx.Clauses(clause.OnConflict{
				Columns: []clause.Column{
					{Name: "user_id"},
					{Name: "token_id"},
					{Name: "model_name"},
					{Name: "created_at"},
				},
				DoUpdates: clause.AssignmentColumns([]string{
					"username",
					"token_name",
					"count",
					"quota",
					"prompt_tokens",
					"completion_tokens",
					"total_tokens",
					"cache_read_tokens",
					"cache_write_tokens",
					"last_used_at",
				}),
			}).Create(&chunk).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	return result, nil
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
		resp.Summary.TotalCacheReadTokens += row.CacheReadTokens
		resp.Summary.TotalCacheWriteTokens += row.CacheWriteTokens
		tokenIDs[row.TokenID] = struct{}{}
		modelNames[row.ModelName] = struct{}{}

		bucket := tokenUsageTrendBucket(row.CreatedAt, granularity)
		trend, ok := trendMap[bucket]
		if !ok {
			trend = &TokenUsageTrendItem{Timestamp: bucket}
			trendMap[bucket] = trend
		}
		addTokenUsageMetrics(&trend.Count, &trend.Quota, &trend.PromptTokens, &trend.CompletionTokens, &trend.TotalTokens, &trend.CacheReadTokens, &trend.CacheWriteTokens, row)

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
		addTokenUsageMetrics(&tokenItem.Count, &tokenItem.Quota, &tokenItem.PromptTokens, &tokenItem.CompletionTokens, &tokenItem.TotalTokens, &tokenItem.CacheReadTokens, &tokenItem.CacheWriteTokens, row)

		modelName := row.ModelName
		modelItem, ok := modelMap[modelName]
		if !ok {
			modelItem = &TokenUsageModelItem{ModelName: modelName}
			modelMap[modelName] = modelItem
		}
		if row.LastUsedAt > modelItem.LastUsedAt {
			modelItem.LastUsedAt = row.LastUsedAt
		}
		addTokenUsageMetrics(&modelItem.Count, &modelItem.Quota, &modelItem.PromptTokens, &modelItem.CompletionTokens, &modelItem.TotalTokens, &modelItem.CacheReadTokens, &modelItem.CacheWriteTokens, row)

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
			CacheReadTokens:  row.CacheReadTokens,
			CacheWriteTokens: row.CacheWriteTokens,
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

func addTokenUsageMetrics(count *int64, quota *int64, promptTokens *int64, completionTokens *int64, totalTokens *int64, cacheReadTokens *int64, cacheWriteTokens *int64, row TokenUsageData) {
	*count += row.Count
	*quota += row.Quota
	*promptTokens += row.PromptTokens
	*completionTokens += row.CompletionTokens
	*totalTokens += row.TotalTokens
	*cacheReadTokens += row.CacheReadTokens
	*cacheWriteTokens += row.CacheWriteTokens
}

func tokenUsageCacheTokensFromOther(other map[string]interface{}) (int64, int64) {
	if other == nil {
		return 0, 0
	}
	cacheReadTokens := tokenUsageFirstPositiveFromOther(other,
		"cache_read_tokens",
		"cache_tokens",
		"cached_tokens",
		"prompt_cache_hit_tokens",
		"prompt_tokens_details.cached_tokens",
		"input_tokens_details.cached_tokens",
	)
	cacheWriteTokens := tokenUsageFirstPositiveFromOther(other, "cache_write_tokens")
	if cacheWriteTokens > 0 {
		return cacheReadTokens, cacheWriteTokens
	}
	cacheWriteTokens5m := tokenUsageInt64FromValue(other["cache_creation_tokens_5m"])
	cacheWriteTokens1h := tokenUsageInt64FromValue(other["cache_creation_tokens_1h"])
	if cacheWriteTokens5m > 0 || cacheWriteTokens1h > 0 {
		return cacheReadTokens, cacheWriteTokens5m + cacheWriteTokens1h
	}
	return cacheReadTokens, tokenUsageFirstPositiveFromOther(other,
		"cache_creation_tokens",
		"cache_creation_input_tokens",
		"cached_creation_tokens",
		"prompt_tokens_details.cached_creation_tokens",
		"input_tokens_details.cached_creation_tokens",
	)
}

func tokenUsageFirstPositiveFromOther(other map[string]interface{}, paths ...string) int64 {
	for _, path := range paths {
		if value := tokenUsageInt64FromPath(other, path); value > 0 {
			return value
		}
	}
	return 0
}

func tokenUsageInt64FromPath(other map[string]interface{}, path string) int64 {
	if other == nil || path == "" {
		return 0
	}
	if value, ok := other[path]; ok {
		return tokenUsageInt64FromValue(value)
	}
	for i := 0; i < len(path); i++ {
		if path[i] != '.' {
			continue
		}
		parent, ok := other[path[:i]].(map[string]interface{})
		if !ok {
			return 0
		}
		return tokenUsageInt64FromPath(parent, path[i+1:])
	}
	return 0
}

func tokenUsageInt64FromValue(value interface{}) int64 {
	var result int64
	switch v := value.(type) {
	case int:
		result = int64(v)
	case int8:
		result = int64(v)
	case int16:
		result = int64(v)
	case int32:
		result = int64(v)
	case int64:
		result = v
	case uint:
		result = int64(v)
	case uint8:
		result = int64(v)
	case uint16:
		result = int64(v)
	case uint32:
		result = int64(v)
	case uint64:
		if v > uint64(^uint64(0)>>1) {
			return 0
		}
		result = int64(v)
	case float32:
		result = int64(v)
	case float64:
		result = int64(v)
	case string:
		if parsed, err := strconv.ParseFloat(v, 64); err == nil {
			result = int64(parsed)
		}
	}
	if result < 0 {
		return 0
	}
	return result
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
		return gorm.Expr(fmt.Sprintf("GREATEST(%s, ?)", tokenUsageExistingColumn("last_used_at")), timestamp)
	}
	return gorm.Expr(fmt.Sprintf("MAX(%s, ?)", tokenUsageExistingColumn("last_used_at")), timestamp)
}

func tokenUsageAddExpr(column string, value interface{}) clause.Expr {
	return gorm.Expr(fmt.Sprintf("%s + ?", tokenUsageExistingColumn(column)), value)
}

func tokenUsageExistingColumn(column string) string {
	if common.UsingPostgreSQL {
		return fmt.Sprintf(`"token_usage_data"."%s"`, column)
	}
	return column
}
