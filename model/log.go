package model

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/types"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"

	"gorm.io/gorm"
)

func applyExplicitLogTextFilter(tx *gorm.DB, column string, value string) (*gorm.DB, error) {
	if value == "" {
		return tx, nil
	}
	if strings.Contains(value, "%") {
		condition, pattern, err := buildLogLikeCondition(column, value)
		if err != nil {
			return nil, err
		}
		return tx.Where(condition, pattern), nil
	}
	return tx.Where(column+" = ?", value), nil
}

func buildLogLikeCondition(column string, value string) (string, string, error) {
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		pattern, err := sanitizeClickHouseLikePattern(value)
		if err != nil {
			return "", "", err
		}
		return column + " LIKE ?", pattern, nil
	}

	pattern, err := sanitizeLikePattern(value)
	if err != nil {
		return "", "", err
	}
	return column + " LIKE ? ESCAPE '!'", pattern, nil
}

func sanitizeClickHouseLikePattern(input string) (string, error) {
	input = strings.ReplaceAll(input, `\`, `\\`)
	input = strings.ReplaceAll(input, `_`, `\_`)

	if err := validateLikePattern(input); err != nil {
		return "", err
	}
	return input, nil
}

type Log struct {
	Id                int    `json:"id" gorm:"index:idx_created_at_id,priority:2;index:idx_user_id_id,priority:2"`
	UserId            int    `json:"user_id" gorm:"index;index:idx_user_id_id,priority:1"`
	CreatedAt         int64  `json:"created_at" gorm:"bigint;index:idx_created_at_id,priority:1;index:idx_created_at_type"`
	Type              int    `json:"type" gorm:"index:idx_created_at_type"`
	Content           string `json:"content"`
	Username          string `json:"username" gorm:"index;index:index_username_model_name,priority:2;default:''"`
	TokenName         string `json:"token_name" gorm:"index;default:''"`
	ModelName         string `json:"model_name" gorm:"index;index:index_username_model_name,priority:1;default:''"`
	Quota             int    `json:"quota" gorm:"default:0"`
	PromptTokens      int    `json:"prompt_tokens" gorm:"default:0"`
	CompletionTokens  int    `json:"completion_tokens" gorm:"default:0"`
	UseTime           int    `json:"use_time" gorm:"default:0"`
	IsStream          bool   `json:"is_stream"`
	ChannelId         int    `json:"channel" gorm:"index"`
	ChannelName       string `json:"channel_name" gorm:"->"`
	TokenId           int    `json:"token_id" gorm:"default:0;index"`
	Group             string `json:"group" gorm:"index"`
	Ip                string `json:"ip" gorm:"index;default:''"`
	RequestId         string `json:"request_id,omitempty" gorm:"type:varchar(64);index:idx_logs_request_id;default:''"`
	UpstreamRequestId string `json:"upstream_request_id,omitempty" gorm:"type:varchar(128);index:idx_logs_upstream_request_id;default:''"`
	Other             string `json:"other"`
}

// don't use iota, avoid change log type value
const (
	LogTypeUnknown = 0
	LogTypeTopup   = 1
	LogTypeConsume = 2
	LogTypeManage  = 3
	LogTypeSystem  = 4
	LogTypeError   = 5
	LogTypeRefund  = 6
	LogTypeLogin   = 7
)

func ensureLogRequestId(log *Log) {
	if log != nil && log.RequestId == "" {
		log.RequestId = common.NewRequestId()
	}
}

func createLog(log *Log) error {
	ensureLogRequestId(log)
	return LOG_DB.Create(log).Error
}

func clickHouseLogOrder(prefix string) string {
	return prefix + "created_at desc, " + prefix + "request_id desc"
}

func assignDisplayLogIds(logs []*Log, startIdx int) {
	for i := range logs {
		logs[i].Id = startIdx + i + 1
	}
}

func formatUserLogs(logs []*Log, startIdx int) {
	for i := range logs {
		logs[i].ChannelName = ""
		var otherMap map[string]interface{}
		otherMap, _ = common.StrToMap(logs[i].Other)
		if otherMap != nil {
			// Remove admin-only debug fields.
			delete(otherMap, "admin_info")
			// Remove operation-audit details (operator/route info), admin-only.
			delete(otherMap, "audit_info")
			// delete(otherMap, "reject_reason")
			delete(otherMap, "stream_status")
		}
		logs[i].Other = common.MapToJsonStr(otherMap)
	}
	assignDisplayLogIds(logs, startIdx)
}

func GetLogByTokenId(tokenId int) (logs []*Log, err error) {
	order := "id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("")
	}
	err = LOG_DB.Model(&Log{}).Where("token_id = ?", tokenId).Order(order).Limit(common.MaxRecentItems).Find(&logs).Error
	formatUserLogs(logs, 0)
	return logs, err
}

func RecordLog(userId int, logType int, content string) {
	if logType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(userId, false)
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      logType,
		Content:   content,
	}
	err := createLog(log)
	if err != nil {
		common.SysLog("failed to record log: " + err.Error())
	}
}

// RecordLogWithAdminInfo 记录操作日志，并将管理员相关信息存入 Other.admin_info，
func RecordLogWithAdminInfo(userId int, logType int, content string, adminInfo map[string]interface{}) {
	if logType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	username, _ := GetUsernameById(userId, false)
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      logType,
		Content:   content,
	}
	if len(adminInfo) > 0 {
		other := map[string]interface{}{
			"admin_info": adminInfo,
		}
		log.Other = common.MapToJsonStr(other)
	}
	if err := createLog(log); err != nil {
		common.SysLog("failed to record log: " + err.Error())
	}
}

// buildOpField 构建语言无关的操作描述（写入 Other.op）。
// 前端依据 action(稳定操作标识) + params(结构化参数) 在渲染期用 i18n 本地化展示，
// 因此不在数据库中存储自然语言句子。
func buildOpField(action string, params map[string]interface{}) map[string]interface{} {
	op := map[string]interface{}{
		"action": action,
	}
	if len(params) > 0 {
		op["params"] = params
	}
	return op
}

// RecordLoginLog 记录用户登录成功的审计日志（type=LogTypeLogin）。
// username 由调用方传入（登录流程已持有用户对象），避免额外的数据库查询。
// content 为英文兜底文本（用于导出/经典前端）；action+params 供前端本地化渲染。
// extra 可携带 login_method、user_agent 等附加信息（普通用户可见）。
func RecordLoginLog(userId int, username string, content string, ip string, action string, params map[string]interface{}, extra map[string]interface{}) {
	other := map[string]interface{}{}
	for k, v := range extra {
		other[k] = v
	}
	other["op"] = buildOpField(action, params)
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      LogTypeLogin,
		Content:   content,
		Ip:        ip,
		Other:     common.MapToJsonStr(other),
	}
	if err := createLog(log); err != nil {
		common.SysLog("failed to record login log: " + err.Error())
	}
}

// RecordOperationAuditLog 记录管理/高危操作审计日志（type=LogTypeManage）。
// logUserId 为日志归属者，管理审计日志应归属实际操作者；目标资源/用户放入
// action params。username 内部按 logUserId 查询。content 为英文兜底文本（导出/经典前端用）。
// action+params 写入 Other.op，供前端本地化渲染（普通用户可见，不含敏感信息）。
// adminInfo 存放操作者身份（写入 Other.admin_info，普通用户查询时剥离）；
// auditInfo 存放路由/方法/结果等中间件兜底信息（写入 Other.audit_info，普通用户查询时剥离）。
func RecordOperationAuditLog(logUserId int, content string, ip string, action string, params map[string]interface{}, adminInfo map[string]interface{}, auditInfo map[string]interface{}) {
	username, _ := GetUsernameById(logUserId, false)
	other := map[string]interface{}{
		"op": buildOpField(action, params),
	}
	if len(adminInfo) > 0 {
		other["admin_info"] = adminInfo
	}
	if len(auditInfo) > 0 {
		other["audit_info"] = auditInfo
	}
	log := &Log{
		UserId:    logUserId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      LogTypeManage,
		Content:   content,
		Ip:        ip,
		Other:     common.MapToJsonStr(other),
	}
	if err := createLog(log); err != nil {
		common.SysLog("failed to record operation audit log: " + err.Error())
	}
}

func RecordTopupLog(userId int, content string, callerIp string, paymentMethod string, callbackPaymentMethod string) {
	username, _ := GetUsernameById(userId, false)
	adminInfo := map[string]interface{}{
		"server_ip":               common.GetIp(),
		"node_name":               common.NodeName,
		"caller_ip":               callerIp,
		"payment_method":          paymentMethod,
		"callback_payment_method": callbackPaymentMethod,
		"version":                 common.Version,
	}
	other := map[string]interface{}{
		"admin_info": adminInfo,
	}
	log := &Log{
		UserId:    userId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      LogTypeTopup,
		Content:   content,
		Ip:        callerIp,
		Other:     common.MapToJsonStr(other),
	}
	err := createLog(log)
	if err != nil {
		common.SysLog("failed to record topup log: " + err.Error())
	}
}

func RecordErrorLog(c *gin.Context, userId int, channelId int, modelName string, tokenName string, content string, tokenId int, useTimeSeconds int,
	isStream bool, group string, other map[string]interface{}) {
	logger.LogInfo(c, fmt.Sprintf("record error log: userId=%d, channelId=%d, modelName=%s, tokenName=%s, content=%s", userId, channelId, modelName, tokenName, common.LocalLogPreview(content)))
	username := c.GetString("username")
	requestId := c.GetString(common.RequestIdKey)
	upstreamRequestId := c.GetString(common.UpstreamRequestIdKey)
	if other == nil {
		other = make(map[string]interface{})
	}
	if errorSummaryString(other["error_fingerprint"]) == "" {
		other["error_fingerprint"] = buildErrorFingerprint(
			errorSummaryString(other["error_type"]),
			errorSummaryString(other["error_code"]),
			errorSummaryInt(other["status_code"]),
			content,
		)
	}
	otherStr := common.MapToJsonStr(other)
	// 判断是否需要记录 IP
	needRecordIp := false
	if settingMap, err := GetUserSetting(userId, false); err == nil {
		if settingMap.RecordIpLog {
			needRecordIp = true
		}
	}
	log := &Log{
		UserId:           userId,
		Username:         username,
		CreatedAt:        common.GetTimestamp(),
		Type:             LogTypeError,
		Content:          content,
		PromptTokens:     0,
		CompletionTokens: 0,
		TokenName:        tokenName,
		ModelName:        modelName,
		Quota:            0,
		ChannelId:        channelId,
		TokenId:          tokenId,
		UseTime:          useTimeSeconds,
		IsStream:         isStream,
		Group:            group,
		Ip: func() string {
			if needRecordIp {
				return c.ClientIP()
			}
			return ""
		}(),
		RequestId:         requestId,
		UpstreamRequestId: upstreamRequestId,
		Other:             otherStr,
	}
	err := createLog(log)
	if err != nil {
		logger.LogError(c, "failed to record log: "+err.Error())
	}
}

type RecordConsumeLogParams struct {
	ChannelId        int                    `json:"channel_id"`
	PromptTokens     int                    `json:"prompt_tokens"`
	CompletionTokens int                    `json:"completion_tokens"`
	ModelName        string                 `json:"model_name"`
	TokenName        string                 `json:"token_name"`
	Quota            int                    `json:"quota"`
	Content          string                 `json:"content"`
	TokenId          int                    `json:"token_id"`
	UseTimeSeconds   int                    `json:"use_time_seconds"`
	IsStream         bool                   `json:"is_stream"`
	Group            string                 `json:"group"`
	Other            map[string]interface{} `json:"other"`
}

func RecordConsumeLog(c *gin.Context, userId int, params RecordConsumeLogParams) {
	username := c.GetString("username")
	createdAt := common.GetTimestamp()
	if !common.LogConsumeEnabled {
		recordTokenUsageDataAsync(userId, username, params, createdAt)
		return
	}
	logger.LogInfo(c, fmt.Sprintf("record consume log: userId=%d, params=%s", userId, common.GetJsonString(params)))
	requestId := c.GetString(common.RequestIdKey)
	upstreamRequestId := c.GetString(common.UpstreamRequestIdKey)
	otherStr := common.MapToJsonStr(params.Other)
	// 判断是否需要记录 IP
	needRecordIp := false
	if settingMap, err := GetUserSetting(userId, false); err == nil {
		if settingMap.RecordIpLog {
			needRecordIp = true
		}
	}
	log := &Log{
		UserId:           userId,
		Username:         username,
		CreatedAt:        createdAt,
		Type:             LogTypeConsume,
		Content:          params.Content,
		PromptTokens:     params.PromptTokens,
		CompletionTokens: params.CompletionTokens,
		TokenName:        params.TokenName,
		ModelName:        params.ModelName,
		Quota:            params.Quota,
		ChannelId:        params.ChannelId,
		TokenId:          params.TokenId,
		UseTime:          params.UseTimeSeconds,
		IsStream:         params.IsStream,
		Group:            params.Group,
		Ip: func() string {
			if needRecordIp {
				return c.ClientIP()
			}
			return ""
		}(),
		RequestId:         requestId,
		UpstreamRequestId: upstreamRequestId,
		Other:             otherStr,
	}
	err := createLog(log)
	if err != nil {
		logger.LogError(c, "failed to record log: "+err.Error())
	}
	recordTokenUsageDataAsync(userId, username, params, createdAt)
	if common.DataExportEnabled {
		LogQuotaData(QuotaDataLogParams{
			UserID:    userId,
			Username:  username,
			ModelName: params.ModelName,
			Quota:     params.Quota,
			CreatedAt: createdAt,
			TokenUsed: params.PromptTokens + params.CompletionTokens,
			UseGroup:  params.Group,
			TokenID:   params.TokenId,
			ChannelID: params.ChannelId,
			NodeName:  common.NodeName,
		})
	}
}

type RecordTaskBillingLogParams struct {
	UserId    int
	LogType   int
	Content   string
	ChannelId int
	ModelName string
	Quota     int
	TokenId   int
	Group     string
	Other     map[string]interface{}
	NodeName  string // 任务发起节点；为空时回退当前节点
}

func RecordTaskBillingLog(params RecordTaskBillingLogParams) {
	createdAt := common.GetTimestamp()
	username, _ := GetUsernameById(params.UserId, false)
	tokenName := ""
	if params.TokenId > 0 {
		if token, err := GetTokenById(params.TokenId); err == nil {
			tokenName = token.Name
		}
	}
	if params.LogType == LogTypeConsume {
		recordTokenUsageDataAsync(params.UserId, username, RecordConsumeLogParams{
			Content:   params.Content,
			ChannelId: params.ChannelId,
			ModelName: params.ModelName,
			TokenName: tokenName,
			Quota:     params.Quota,
			TokenId:   params.TokenId,
			Group:     params.Group,
			Other:     params.Other,
		}, createdAt)
	}
	if params.LogType == LogTypeConsume && !common.LogConsumeEnabled {
		return
	}
	log := &Log{
		UserId:    params.UserId,
		Username:  username,
		CreatedAt: createdAt,
		Type:      params.LogType,
		Content:   params.Content,
		TokenName: tokenName,
		ModelName: params.ModelName,
		Quota:     params.Quota,
		ChannelId: params.ChannelId,
		TokenId:   params.TokenId,
		Group:     params.Group,
		Other:     common.MapToJsonStr(params.Other),
	}
	err := createLog(log)
	if err != nil {
		common.SysLog("failed to record task billing log: " + err.Error())
	}
	if params.LogType == LogTypeConsume && common.DataExportEnabled {
		nodeName := params.NodeName
		if nodeName == "" {
			nodeName = common.NodeName
		}
		LogQuotaData(QuotaDataLogParams{
			UserID:    params.UserId,
			Username:  username,
			ModelName: params.ModelName,
			Quota:     params.Quota,
			CreatedAt: createdAt,
			UseGroup:  params.Group,
			TokenID:   params.TokenId,
			ChannelID: params.ChannelId,
			NodeName:  nodeName,
		})
	}
}

func recordTokenUsageDataAsync(userId int, username string, params RecordConsumeLogParams, createdAt int64) {
	if userId <= 0 || params.TokenId <= 0 {
		return
	}
	gopool.Go(func() {
		if err := RecordTokenUsageData(userId, username, params, createdAt); err != nil {
			common.SysLog("failed to record token usage data: " + err.Error())
		}
	})
}

func GetAllLogs(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string, startIdx int, num int, channel int, group string, requestId string, upstreamRequestId string) (logs []*Log, total int64, err error) {
	var tx *gorm.DB
	if logType == LogTypeUnknown {
		tx = LOG_DB
	} else {
		tx = LOG_DB.Where("logs.type = ?", logType)
	}

	if tx, err = applyExplicitLogTextFilter(tx, "logs.model_name", modelName); err != nil {
		return nil, 0, err
	}
	if tx, err = applyExplicitLogTextFilter(tx, "logs.username", username); err != nil {
		return nil, 0, err
	}
	if tokenName != "" {
		tx = tx.Where("logs.token_name = ?", tokenName)
	}
	if requestId != "" {
		tx = tx.Where("logs.request_id = ?", requestId)
	}
	if upstreamRequestId != "" {
		tx = tx.Where("logs.upstream_request_id = ?", upstreamRequestId)
	}
	if startTimestamp != 0 {
		tx = tx.Where("logs.created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("logs.created_at <= ?", endTimestamp)
	}
	if channel != 0 {
		tx = tx.Where("logs.channel_id = ?", channel)
	}
	if group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", group)
	}
	err = tx.Model(&Log{}).Count(&total).Error
	if err != nil {
		return nil, 0, err
	}
	order := "logs.created_at desc, logs.id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("logs.")
	}
	err = tx.Order(order).Limit(num).Offset(startIdx).Find(&logs).Error
	if err != nil {
		return nil, 0, err
	}
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		assignDisplayLogIds(logs, startIdx)
	}

	channelIds := types.NewSet[int]()
	for _, log := range logs {
		if log.ChannelId != 0 {
			channelIds.Add(log.ChannelId)
		}
	}

	if channelIds.Len() > 0 {
		var channels []struct {
			Id   int    `gorm:"column:id"`
			Name string `gorm:"column:name"`
		}
		if common.MemoryCacheEnabled {
			// Cache get channel
			for _, channelId := range channelIds.Items() {
				if cacheChannel, err := CacheGetChannel(channelId); err == nil {
					channels = append(channels, struct {
						Id   int    `gorm:"column:id"`
						Name string `gorm:"column:name"`
					}{
						Id:   channelId,
						Name: cacheChannel.Name,
					})
				}
			}
		} else {
			// Bulk query channels from DB
			if err = DB.Table("channels").Select("id, name").Where("id IN ?", channelIds.Items()).Find(&channels).Error; err != nil {
				return logs, total, err
			}
		}
		channelMap := make(map[int]string, len(channels))
		for _, channel := range channels {
			channelMap[channel.Id] = channel.Name
		}
		for i := range logs {
			logs[i].ChannelName = channelMap[logs[i].ChannelId]
		}
	}

	return logs, total, err
}

type ErrorLogSummaryQuery struct {
	Hours     int
	Limit     int
	StartTime int64
	EndTime   int64
	ModelName string
	ChannelId int
	Group     string
}

type ErrorLogSummaryResponse struct {
	Items       []*ErrorLogSummaryItem `json:"items"`
	ScannedLogs int                    `json:"scanned_logs"`
	TotalLogs   int64                  `json:"total_logs"`
	Truncated   bool                   `json:"truncated"`
	StartTime   int64                  `json:"start_time"`
	EndTime     int64                  `json:"end_time"`
}

type ErrorLogSummaryItem struct {
	Key                            string                       `json:"key"`
	Fingerprint                    string                       `json:"fingerprint"`
	ModelName                      string                       `json:"model_name"`
	Group                          string                       `json:"group"`
	ChannelId                      int                          `json:"channel"`
	ChannelName                    string                       `json:"channel_name"`
	ChannelStatus                  int                          `json:"channel_status"`
	ChannelPriority                int64                        `json:"channel_priority"`
	ChannelResponseTime            int                          `json:"channel_response_time"`
	ChannelTestTime                int64                        `json:"channel_test_time"`
	AutomaticChannelTestDisabled   bool                         `json:"automatic_channel_test_disabled"`
	AutoTestChannelIntervalMinutes float64                      `json:"auto_test_channel_interval_minutes"`
	MultiKeyTotal                  int                          `json:"multi_key_total"`
	MultiKeyEnabled                int                          `json:"multi_key_enabled"`
	MultiKeyAutoDisabled           int                          `json:"multi_key_auto_disabled"`
	MultiKeyManualDisabled         int                          `json:"multi_key_manual_disabled"`
	PeerChannels                   []ErrorLogSummaryPeerChannel `json:"peer_channels"`
	ErrorType                      string                       `json:"error_type"`
	ErrorCode                      string                       `json:"error_code"`
	StatusCode                     int                          `json:"status_code"`
	ErrorSummary                   string                       `json:"error_summary"`
	Count                          int                          `json:"count"`
	AffectedRequests               int                          `json:"affected_requests"`
	AffectedUsers                  int                          `json:"affected_users"`
	CurrentCount                   int                          `json:"current_count"`
	PreviousCount                  int                          `json:"previous_count"`
	Trend                          string                       `json:"trend"`
	Severity                       string                       `json:"severity"`
	RouteAttemptCount              int                          `json:"route_attempt_count"`
	RouteSuccessCount              int                          `json:"route_success_count"`
	RouteErrorCount                int                          `json:"route_error_count"`
	RouteErrorRate                 float64                      `json:"route_error_rate"`
	FirstSeen                      int64                        `json:"first_seen"`
	LastSeen                       int64                        `json:"last_seen"`
	SampleContent                  string                       `json:"sample_content"`
	SampleRequestId                string                       `json:"sample_request_id"`
	SampleUpstreamRequestId        string                       `json:"sample_upstream_request_id"`
	SampleGroup                    string                       `json:"sample_group"`
	MaxUseTime                     int                          `json:"max_use_time"`
}

type ErrorLogSummaryPeerChannel struct {
	ChannelId                      int     `json:"channel"`
	ChannelName                    string  `json:"channel_name"`
	ChannelStatus                  int     `json:"channel_status"`
	ChannelPriority                int64   `json:"channel_priority"`
	ChannelWeight                  uint    `json:"channel_weight"`
	AbilityEnabled                 bool    `json:"ability_enabled"`
	ChannelResponseTime            int     `json:"channel_response_time"`
	ChannelTestTime                int64   `json:"channel_test_time"`
	AutomaticChannelTestDisabled   bool    `json:"automatic_channel_test_disabled"`
	AutoTestChannelIntervalMinutes float64 `json:"auto_test_channel_interval_minutes"`
	MultiKeyTotal                  int     `json:"multi_key_total"`
	MultiKeyEnabled                int     `json:"multi_key_enabled"`
	MultiKeyAutoDisabled           int     `json:"multi_key_auto_disabled"`
	MultiKeyManualDisabled         int     `json:"multi_key_manual_disabled"`
	RecentErrorCount               int     `json:"recent_error_count"`
	RecentAttemptCount             int     `json:"recent_attempt_count"`
	RecentSuccessCount             int     `json:"recent_success_count"`
	RecentErrorRate                float64 `json:"recent_error_rate"`
	LastErrorTime                  int64   `json:"last_error_time"`
	IsCurrent                      bool    `json:"is_current"`
}

const (
	defaultErrorSummaryHours  = 24
	maxErrorSummaryHours      = 168
	defaultErrorSummaryLimit  = 50
	maxErrorSummaryLimit      = 200
	maxErrorSummaryCandidates = 400
	errorSummaryScanLimit     = 10000
	errorSummaryTextLimit     = 180
	errorFingerprintTextLimit = 512
)

var (
	errorFingerprintURLPattern    = regexp.MustCompile(`https?://\S+`)
	errorFingerprintUUIDPattern   = regexp.MustCompile(`(?i)\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`)
	errorFingerprintTokenPattern  = regexp.MustCompile(`(?i)\b[0-9a-f]{16,}\b`)
	errorFingerprintNumberPattern = regexp.MustCompile(`\b\d+(?:\.\d+)?\b`)
)

func GetErrorLogSummary(query ErrorLogSummaryQuery) (*ErrorLogSummaryResponse, error) {
	if query.Hours <= 0 {
		query.Hours = defaultErrorSummaryHours
	}
	if query.Hours > maxErrorSummaryHours {
		query.Hours = maxErrorSummaryHours
	}
	if query.Limit <= 0 {
		query.Limit = defaultErrorSummaryLimit
	}
	if query.Limit > maxErrorSummaryLimit {
		query.Limit = maxErrorSummaryLimit
	}

	startTime, endTime := resolveErrorSummaryTimeRange(query)
	tx := LOG_DB.Model(&Log{}).
		Where("logs.type = ?", LogTypeError).
		Where("logs.created_at >= ?", startTime).
		Where("logs.created_at <= ?", endTime)

	var err error
	if tx, err = applyExplicitLogTextFilter(tx, "logs.model_name", query.ModelName); err != nil {
		return nil, err
	}
	if query.ChannelId > 0 {
		tx = tx.Where("logs.channel_id = ?", query.ChannelId)
	}
	if query.Group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", query.Group)
	}

	var total int64
	if err = tx.Count(&total).Error; err != nil {
		return nil, err
	}

	order := "logs.created_at desc, logs.id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("logs.")
	}
	var logs []*Log
	if err = tx.Order(order).Limit(errorSummaryScanLimit).Find(&logs).Error; err != nil {
		return nil, err
	}

	midpoint := startTime + (endTime-startTime)/2
	summaryMap := make(map[string]*ErrorLogSummaryItem)
	requestIdsByKey := make(map[string]map[string]struct{})
	userIdsByKey := make(map[string]map[int]struct{})
	channelIds := make(map[int]struct{})
	for _, log := range logs {
		item := buildErrorLogSummaryItem(log)
		key := item.Key
		requestKey := errorSummaryRequestKey(log)
		requestIds, ok := requestIdsByKey[key]
		if !ok {
			requestIds = make(map[string]struct{})
			requestIdsByKey[key] = requestIds
		}
		requestIds[requestKey] = struct{}{}
		if log.UserId > 0 {
			userIds, ok := userIdsByKey[key]
			if !ok {
				userIds = make(map[int]struct{})
				userIdsByKey[key] = userIds
			}
			userIds[log.UserId] = struct{}{}
		}
		if existing, ok := summaryMap[key]; ok {
			existing.Count++
			if log.CreatedAt >= midpoint {
				existing.CurrentCount++
			} else {
				existing.PreviousCount++
			}
			if log.CreatedAt > existing.LastSeen {
				existing.LastSeen = log.CreatedAt
				existing.SampleContent = item.SampleContent
				existing.SampleRequestId = item.SampleRequestId
				existing.SampleUpstreamRequestId = item.SampleUpstreamRequestId
				existing.SampleGroup = item.SampleGroup
			}
			if log.CreatedAt < existing.FirstSeen {
				existing.FirstSeen = log.CreatedAt
			}
			if log.UseTime > existing.MaxUseTime {
				existing.MaxUseTime = log.UseTime
			}
			continue
		}
		if log.CreatedAt >= midpoint {
			item.CurrentCount = 1
		} else {
			item.PreviousCount = 1
		}
		summaryMap[key] = item
		if log.ChannelId != 0 {
			channelIds[log.ChannelId] = struct{}{}
		}
	}

	channelMap, err := getErrorSummaryChannelMap(channelIds)
	if err != nil {
		return nil, err
	}

	items := make([]*ErrorLogSummaryItem, 0, len(summaryMap))
	for _, item := range summaryMap {
		item.AffectedRequests = len(requestIdsByKey[item.Key])
		item.AffectedUsers = len(userIdsByKey[item.Key])
		if channel, ok := channelMap[item.ChannelId]; ok {
			applyErrorSummaryChannelInfo(item, channel)
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Count != items[j].Count {
			return items[i].Count > items[j].Count
		}
		return items[i].LastSeen > items[j].LastSeen
	})
	candidateLimit := min(query.Limit*2, maxErrorSummaryCandidates)
	if len(items) > candidateLimit {
		items = items[:candidateLimit]
	}
	routeStats, err := getErrorSummaryRouteStats(items, startTime, endTime)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		applyErrorSummaryRouteStats(item, routeStats)
		item.Trend = classifyErrorSummaryTrend(item.CurrentCount, item.PreviousCount)
		item.Severity = classifyErrorSummarySeverity(item)
	}
	sort.SliceStable(items, func(i, j int) bool {
		leftSeverity := errorSummarySeverityRank(items[i].Severity)
		rightSeverity := errorSummarySeverityRank(items[j].Severity)
		if leftSeverity != rightSeverity {
			return leftSeverity > rightSeverity
		}
		if items[i].CurrentCount != items[j].CurrentCount {
			return items[i].CurrentCount > items[j].CurrentCount
		}
		if items[i].Count != items[j].Count {
			return items[i].Count > items[j].Count
		}
		return items[i].LastSeen > items[j].LastSeen
	})
	if len(items) > query.Limit {
		items = items[:query.Limit]
	}
	if err = applyErrorSummaryPeerChannels(items, routeStats); err != nil {
		return nil, err
	}

	return &ErrorLogSummaryResponse{
		Items:       items,
		ScannedLogs: len(logs),
		TotalLogs:   total,
		Truncated:   total > int64(len(logs)),
		StartTime:   startTime,
		EndTime:     endTime,
	}, nil
}

func resolveErrorSummaryTimeRange(query ErrorLogSummaryQuery) (int64, int64) {
	now := common.GetTimestamp()
	if query.StartTime <= 0 && query.EndTime <= 0 {
		endTime := now
		return endTime - int64(query.Hours*3600), endTime
	}

	endTime := query.EndTime
	if endTime <= 0 || endTime > now {
		endTime = now
	}
	startTime := query.StartTime
	if startTime <= 0 || startTime > endTime {
		startTime = endTime - int64(query.Hours*3600)
	}

	maxRangeSeconds := int64(maxErrorSummaryHours * 3600)
	if endTime-startTime > maxRangeSeconds {
		startTime = endTime - maxRangeSeconds
	}
	return startTime, endTime
}

func buildErrorLogSummaryItem(log *Log) *ErrorLogSummaryItem {
	other, _ := common.StrToMap(log.Other)
	errorType := errorSummaryString(other["error_type"])
	errorCode := errorSummaryString(other["error_code"])
	statusCode := errorSummaryInt(other["status_code"])
	contentSummary := normalizeErrorSummaryText(log.Content)
	fingerprint := errorSummaryString(other["error_fingerprint"])
	if fingerprint == "" {
		fingerprint = buildErrorFingerprint(errorType, errorCode, statusCode, log.Content)
	}
	key := strings.Join([]string{
		log.ModelName,
		log.Group,
		fmt.Sprintf("%d", log.ChannelId),
		fingerprint,
	}, "\x1f")

	return &ErrorLogSummaryItem{
		Key:                     key,
		Fingerprint:             fingerprint,
		ModelName:               log.ModelName,
		Group:                   log.Group,
		ChannelId:               log.ChannelId,
		ChannelName:             errorSummaryString(other["channel_name"]),
		ErrorType:               errorType,
		ErrorCode:               errorCode,
		StatusCode:              statusCode,
		ErrorSummary:            contentSummary,
		Count:                   1,
		FirstSeen:               log.CreatedAt,
		LastSeen:                log.CreatedAt,
		SampleContent:           normalizeErrorSummaryText(log.Content),
		SampleRequestId:         log.RequestId,
		SampleUpstreamRequestId: log.UpstreamRequestId,
		SampleGroup:             log.Group,
		MaxUseTime:              log.UseTime,
	}
}

type errorSummaryRouteKey struct {
	ChannelId int
	Model     string
	Group     string
}

type errorSummaryModelGroupKey struct {
	Model string
	Group string
}

type errorSummaryRouteStats struct {
	Attempts  int
	Successes int
	Errors    int
	LastError int64
}

type errorSummaryRouteStatsRow struct {
	ChannelId int    `gorm:"column:channel_id"`
	ModelName string `gorm:"column:model_name"`
	Group     string `gorm:"column:log_group"`
	LogType   int    `gorm:"column:log_type"`
	Count     int64  `gorm:"column:count"`
	LastSeen  int64  `gorm:"column:last_seen"`
}

func errorSummaryRequestKey(log *Log) string {
	if log.RequestId != "" {
		return "request:" + log.RequestId
	}
	if log.UpstreamRequestId != "" {
		return "upstream:" + log.UpstreamRequestId
	}
	return fmt.Sprintf("log:%d", log.Id)
}

func getErrorSummaryRouteStats(items []*ErrorLogSummaryItem, startTime, endTime int64) (map[errorSummaryRouteKey]errorSummaryRouteStats, error) {
	modelGroups := make(map[errorSummaryModelGroupKey]struct{})
	for _, item := range items {
		if item.ModelName == "" {
			continue
		}
		modelGroups[errorSummaryModelGroupKey{Model: item.ModelName, Group: item.Group}] = struct{}{}
	}
	if len(modelGroups) == 0 {
		return map[errorSummaryRouteKey]errorSummaryRouteStats{}, nil
	}

	conditions := make([]string, 0, len(modelGroups))
	args := make([]any, 0, len(modelGroups)*2)
	for key := range modelGroups {
		conditions = append(conditions, "(logs.model_name = ? AND logs."+logGroupCol+" = ?)")
		args = append(args, key.Model, key.Group)
	}

	selectFields := strings.Join([]string{
		"logs.channel_id AS channel_id",
		"logs.model_name AS model_name",
		"logs." + logGroupCol + " AS log_group",
		"logs.type AS log_type",
		"COUNT(*) AS count",
		"MAX(logs.created_at) AS last_seen",
	}, ", ")
	groupFields := strings.Join([]string{
		"logs.channel_id",
		"logs.model_name",
		"logs." + logGroupCol,
		"logs.type",
	}, ", ")

	var rows []errorSummaryRouteStatsRow
	err := LOG_DB.Model(&Log{}).
		Select(selectFields).
		Where("logs.type IN ?", []int{LogTypeConsume, LogTypeError}).
		Where("logs.created_at >= ?", startTime).
		Where("logs.created_at <= ?", endTime).
		Where("("+strings.Join(conditions, " OR ")+")", args...).
		Group(groupFields).
		Find(&rows).Error
	if err != nil {
		return nil, err
	}

	statsByRoute := make(map[errorSummaryRouteKey]errorSummaryRouteStats, len(rows))
	for _, row := range rows {
		key := errorSummaryRouteKey{ChannelId: row.ChannelId, Model: row.ModelName, Group: row.Group}
		stats := statsByRoute[key]
		count := int(row.Count)
		stats.Attempts += count
		if row.LogType == LogTypeError {
			stats.Errors += count
			if row.LastSeen > stats.LastError {
				stats.LastError = row.LastSeen
			}
		} else if row.LogType == LogTypeConsume {
			stats.Successes += count
		}
		statsByRoute[key] = stats
	}
	return statsByRoute, nil
}

func applyErrorSummaryRouteStats(item *ErrorLogSummaryItem, statsByRoute map[errorSummaryRouteKey]errorSummaryRouteStats) {
	stats := statsByRoute[errorSummaryRouteKey{ChannelId: item.ChannelId, Model: item.ModelName, Group: item.Group}]
	item.RouteAttemptCount = stats.Attempts
	item.RouteSuccessCount = stats.Successes
	item.RouteErrorCount = stats.Errors
	if stats.Attempts > 0 {
		item.RouteErrorRate = float64(stats.Errors) / float64(stats.Attempts)
	}
}

func classifyErrorSummaryTrend(currentCount, previousCount int) string {
	if currentCount > 0 && previousCount == 0 {
		return "new"
	}
	if currentCount >= previousCount+max(2, previousCount/2) {
		return "rising"
	}
	if previousCount >= currentCount+max(2, currentCount/2) {
		return "falling"
	}
	return "stable"
}

func classifyErrorSummarySeverity(item *ErrorLogSummaryItem) string {
	isEnabled := item.ChannelStatus == common.ChannelStatusEnabled
	isAuthFailure := item.StatusCode == 401 || item.StatusCode == 403
	isServerFailure := item.StatusCode >= 500
	if isEnabled && item.RouteAttemptCount >= 5 && item.RouteErrorRate >= 0.5 {
		return "critical"
	}
	if isEnabled && (isAuthFailure || isServerFailure || item.RouteErrorRate >= 0.2) {
		return "high"
	}
	if item.StatusCode >= 400 || item.Count >= 3 {
		return "medium"
	}
	return "low"
}

func errorSummarySeverityRank(severity string) int {
	switch severity {
	case "critical":
		return 4
	case "high":
		return 3
	case "medium":
		return 2
	case "low":
		return 1
	default:
		return 0
	}
}

func getErrorSummaryChannelMap(channelIds map[int]struct{}) (map[int]Channel, error) {
	if len(channelIds) == 0 {
		return map[int]Channel{}, nil
	}
	ids := make([]int, 0, len(channelIds))
	for id := range channelIds {
		ids = append(ids, id)
	}

	var channels []Channel
	err := DB.Model(&Channel{}).
		Select("id, name, status, priority, response_time, test_time, channel_info, settings").
		Where("id IN ?", ids).
		Find(&channels).Error
	if err != nil {
		return nil, err
	}
	channelMap := make(map[int]Channel, len(channels))
	for _, channel := range channels {
		channelMap[channel.Id] = channel
	}
	return channelMap, nil
}

func applyErrorSummaryChannelInfo(item *ErrorLogSummaryItem, channel Channel) {
	item.ChannelName = channel.Name
	item.ChannelStatus = channel.Status
	item.ChannelResponseTime = channel.ResponseTime
	item.ChannelTestTime = channel.TestTime
	if channel.Priority != nil {
		item.ChannelPriority = *channel.Priority
	}

	settings := dto.ChannelOtherSettings{}
	if channel.OtherSettings != "" {
		_ = common.UnmarshalJsonStr(channel.OtherSettings, &settings)
	}
	item.AutomaticChannelTestDisabled = settings.AutomaticChannelTestDisabled
	item.AutoTestChannelIntervalMinutes = settings.AutoTestChannelIntervalMinutes

	if !channel.ChannelInfo.IsMultiKey {
		return
	}
	item.MultiKeyTotal = channel.ChannelInfo.MultiKeySize
	item.MultiKeyEnabled = channel.ChannelInfo.MultiKeySize
	for _, status := range channel.ChannelInfo.MultiKeyStatusList {
		switch status {
		case common.ChannelStatusAutoDisabled:
			item.MultiKeyAutoDisabled++
			item.MultiKeyEnabled--
		case common.ChannelStatusManuallyDisabled:
			item.MultiKeyManualDisabled++
			item.MultiKeyEnabled--
		}
	}
	if item.MultiKeyEnabled < 0 {
		item.MultiKeyEnabled = 0
	}
}

type errorSummaryPeerKey struct {
	Model string
	Group string
}

type errorSummaryPeerChannelRow struct {
	ChannelId     int         `gorm:"column:channel_id"`
	ChannelName   string      `gorm:"column:channel_name"`
	ChannelStatus int         `gorm:"column:channel_status"`
	Priority      *int64      `gorm:"column:priority"`
	Weight        uint        `gorm:"column:weight"`
	Enabled       bool        `gorm:"column:enabled"`
	ResponseTime  int         `gorm:"column:response_time"`
	TestTime      int64       `gorm:"column:test_time"`
	ChannelInfo   ChannelInfo `gorm:"column:channel_info"`
	Settings      string      `gorm:"column:settings"`
}

func applyErrorSummaryPeerChannels(items []*ErrorLogSummaryItem, routeStats map[errorSummaryRouteKey]errorSummaryRouteStats) error {
	peerKeys := make(map[errorSummaryPeerKey]struct{})
	for _, item := range items {
		key := errorSummaryPeerKey{
			Model: item.ModelName,
			Group: item.Group,
		}
		if key.Model == "" || key.Group == "" {
			continue
		}
		peerKeys[key] = struct{}{}
	}
	if len(peerKeys) == 0 {
		return nil
	}

	peerChannelsByKey := make(map[errorSummaryPeerKey][]ErrorLogSummaryPeerChannel, len(peerKeys))
	for key := range peerKeys {
		peerChannels, err := getErrorSummaryPeerChannels(key, routeStats)
		if err != nil {
			return err
		}
		peerChannelsByKey[key] = peerChannels
	}

	for _, item := range items {
		key := errorSummaryPeerKey{
			Model: item.ModelName,
			Group: item.Group,
		}
		peers := peerChannelsByKey[key]
		if len(peers) == 0 {
			continue
		}
		item.PeerChannels = make([]ErrorLogSummaryPeerChannel, len(peers))
		copy(item.PeerChannels, peers)
		for i := range item.PeerChannels {
			item.PeerChannels[i].IsCurrent = item.PeerChannels[i].ChannelId == item.ChannelId
		}
	}
	return nil
}

func getErrorSummaryPeerChannels(key errorSummaryPeerKey, routeStats map[errorSummaryRouteKey]errorSummaryRouteStats) ([]ErrorLogSummaryPeerChannel, error) {
	var rows []errorSummaryPeerChannelRow
	err := DB.Table("abilities").
		Select(strings.Join([]string{
			"abilities.channel_id",
			"abilities.enabled",
			"abilities.priority",
			"abilities.weight",
			"channels.name AS channel_name",
			"channels.status AS channel_status",
			"channels.response_time",
			"channels.test_time",
			"channels.channel_info",
			"channels.settings",
		}, ", ")).
		Joins("JOIN channels ON channels.id = abilities.channel_id").
		Where("abilities."+commonGroupCol+" = ? AND abilities.model = ?", key.Group, key.Model).
		Order("COALESCE(abilities.priority, 0) DESC").
		Order("abilities.weight DESC").
		Order("abilities.channel_id ASC").
		Find(&rows).Error
	if err != nil {
		return nil, err
	}

	peerChannels := make([]ErrorLogSummaryPeerChannel, 0, len(rows))
	for _, row := range rows {
		priority := int64(0)
		if row.Priority != nil {
			priority = *row.Priority
		}
		peer := ErrorLogSummaryPeerChannel{
			ChannelId:           row.ChannelId,
			ChannelName:         row.ChannelName,
			ChannelStatus:       row.ChannelStatus,
			ChannelPriority:     priority,
			ChannelWeight:       row.Weight,
			AbilityEnabled:      row.Enabled,
			ChannelResponseTime: row.ResponseTime,
			ChannelTestTime:     row.TestTime,
		}
		applyErrorSummaryPeerChannelSettings(&peer, row.ChannelInfo, row.Settings)
		if stats, ok := routeStats[errorSummaryRouteKey{ChannelId: row.ChannelId, Model: key.Model, Group: key.Group}]; ok {
			peer.RecentAttemptCount = stats.Attempts
			peer.RecentSuccessCount = stats.Successes
			peer.RecentErrorCount = stats.Errors
			if stats.Attempts > 0 {
				peer.RecentErrorRate = float64(stats.Errors) / float64(stats.Attempts)
			}
			peer.LastErrorTime = stats.LastError
		}
		peerChannels = append(peerChannels, peer)
	}
	return peerChannels, nil
}

func applyErrorSummaryPeerChannelSettings(peer *ErrorLogSummaryPeerChannel, channelInfo ChannelInfo, settingsJson string) {
	settings := dto.ChannelOtherSettings{}
	if settingsJson != "" {
		_ = common.UnmarshalJsonStr(settingsJson, &settings)
	}
	peer.AutomaticChannelTestDisabled = settings.AutomaticChannelTestDisabled
	peer.AutoTestChannelIntervalMinutes = settings.AutoTestChannelIntervalMinutes

	if !channelInfo.IsMultiKey {
		return
	}
	peer.MultiKeyTotal = channelInfo.MultiKeySize
	peer.MultiKeyEnabled = channelInfo.MultiKeySize
	for _, status := range channelInfo.MultiKeyStatusList {
		switch status {
		case common.ChannelStatusAutoDisabled:
			peer.MultiKeyAutoDisabled++
			peer.MultiKeyEnabled--
		case common.ChannelStatusManuallyDisabled:
			peer.MultiKeyManualDisabled++
			peer.MultiKeyEnabled--
		}
	}
	if peer.MultiKeyEnabled < 0 {
		peer.MultiKeyEnabled = 0
	}
}

func errorSummaryString(value interface{}) string {
	return strings.TrimSpace(common.Interface2String(value))
}

func errorSummaryInt(value interface{}) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case float32:
		return int(v)
	case string:
		var result int
		if _, err := fmt.Sscanf(v, "%d", &result); err == nil {
			return result
		}
	}
	return 0
}

func normalizeErrorSummaryText(content string) string {
	content = strings.Join(strings.Fields(content), " ")
	runes := []rune(content)
	if len(runes) <= errorSummaryTextLimit {
		return content
	}
	return string(runes[:errorSummaryTextLimit]) + "..."
}

func normalizeErrorFingerprintText(content string) string {
	content = strings.ToLower(strings.Join(strings.Fields(content), " "))
	content = errorFingerprintURLPattern.ReplaceAllString(content, "<url>")
	content = errorFingerprintUUIDPattern.ReplaceAllString(content, "<uuid>")
	content = errorFingerprintTokenPattern.ReplaceAllString(content, "<token>")
	content = errorFingerprintNumberPattern.ReplaceAllString(content, "<number>")
	runes := []rune(content)
	if len(runes) <= errorFingerprintTextLimit {
		return content
	}
	return string(runes[:errorFingerprintTextLimit])
}

func buildErrorFingerprint(errorType, errorCode string, statusCode int, content string) string {
	source := strings.Join([]string{
		strings.ToLower(strings.TrimSpace(errorType)),
		strings.ToLower(strings.TrimSpace(errorCode)),
		fmt.Sprintf("%d", statusCode),
		normalizeErrorFingerprintText(content),
	}, "\x1f")
	sum := sha256.Sum256([]byte(source))
	return fmt.Sprintf("%x", sum[:8])
}

const logSearchCountLimit = 10000

func GetUserLogs(userId int, logType int, startTimestamp int64, endTimestamp int64, modelName string, tokenName string, startIdx int, num int, group string, requestId string, upstreamRequestId string) (logs []*Log, total int64, err error) {
	var tx *gorm.DB
	if logType == LogTypeUnknown {
		tx = LOG_DB.Where("logs.user_id = ?", userId)
	} else {
		tx = LOG_DB.Where("logs.user_id = ? and logs.type = ?", userId, logType)
	}

	if tx, err = applyExplicitLogTextFilter(tx, "logs.model_name", modelName); err != nil {
		return nil, 0, err
	}
	if tokenName != "" {
		tx = tx.Where("logs.token_name = ?", tokenName)
	}
	if requestId != "" {
		tx = tx.Where("logs.request_id = ?", requestId)
	}
	if upstreamRequestId != "" {
		tx = tx.Where("logs.upstream_request_id = ?", upstreamRequestId)
	}
	if startTimestamp != 0 {
		tx = tx.Where("logs.created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("logs.created_at <= ?", endTimestamp)
	}
	if group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", group)
	}
	err = tx.Model(&Log{}).Limit(logSearchCountLimit).Count(&total).Error
	if err != nil {
		common.SysError("failed to count user logs: " + err.Error())
		return nil, 0, errors.New("查询日志失败")
	}
	order := "logs.id desc"
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("logs.")
	}
	err = tx.Order(order).Limit(num).Offset(startIdx).Find(&logs).Error
	if err != nil {
		common.SysError("failed to search user logs: " + err.Error())
		return nil, 0, errors.New("查询日志失败")
	}

	formatUserLogs(logs, startIdx)
	return logs, total, err
}

type Stat struct {
	Quota       int   `json:"quota"`
	Rpm         int   `json:"rpm"`
	Tpm         int   `json:"tpm"`
	TotalTokens int64 `json:"total_tokens"`
}

func SumUsedQuota(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string, channel int, group string) (stat Stat, err error) {
	tx := LOG_DB.Table("logs").Select("COALESCE(sum(quota), 0) quota, COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0) total_tokens")

	// 为rpm和tpm创建单独的查询
	rpmTpmQuery := LOG_DB.Table("logs").Select("count(*) rpm, COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0) tpm")

	if tx, err = applyExplicitLogTextFilter(tx, "username", username); err != nil {
		return stat, err
	}
	if rpmTpmQuery, err = applyExplicitLogTextFilter(rpmTpmQuery, "username", username); err != nil {
		return stat, err
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
		rpmTpmQuery = rpmTpmQuery.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if tx, err = applyExplicitLogTextFilter(tx, "model_name", modelName); err != nil {
		return stat, err
	}
	if rpmTpmQuery, err = applyExplicitLogTextFilter(rpmTpmQuery, "model_name", modelName); err != nil {
		return stat, err
	}
	if channel != 0 {
		tx = tx.Where("channel_id = ?", channel)
		rpmTpmQuery = rpmTpmQuery.Where("channel_id = ?", channel)
	}
	if group != "" {
		tx = tx.Where(logGroupCol+" = ?", group)
		rpmTpmQuery = rpmTpmQuery.Where(logGroupCol+" = ?", group)
	}

	tx = tx.Where("type = ?", LogTypeConsume)
	rpmTpmQuery = rpmTpmQuery.Where("type = ?", LogTypeConsume)

	// 只统计最近60秒的rpm和tpm
	rpmTpmQuery = rpmTpmQuery.Where("created_at >= ?", time.Now().Add(-60*time.Second).Unix())

	// 执行查询
	if err := tx.Scan(&stat).Error; err != nil {
		common.SysError("failed to query log stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}
	if err := rpmTpmQuery.Scan(&stat).Error; err != nil {
		common.SysError("failed to query rpm/tpm stat: " + err.Error())
		return stat, errors.New("查询统计数据失败")
	}

	return stat, nil
}

func SumUsedToken(logType int, startTimestamp int64, endTimestamp int64, modelName string, username string, tokenName string) (token int) {
	tx := LOG_DB.Table("logs").Select("COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0)")
	if username != "" {
		tx = tx.Where("username = ?", username)
	}
	if tokenName != "" {
		tx = tx.Where("token_name = ?", tokenName)
	}
	if startTimestamp != 0 {
		tx = tx.Where("created_at >= ?", startTimestamp)
	}
	if endTimestamp != 0 {
		tx = tx.Where("created_at <= ?", endTimestamp)
	}
	if modelName != "" {
		tx = tx.Where("model_name = ?", modelName)
	}
	tx.Where("type = ?", LogTypeConsume).Scan(&token)
	return token
}

func CountOldLog(ctx context.Context, targetTimestamp int64) (int64, error) {
	var total int64
	if err := LOG_DB.WithContext(ctx).Model(&Log{}).Where("created_at < ?", targetTimestamp).Count(&total).Error; err != nil {
		return 0, err
	}
	return total, nil
}

func DeleteOldLogBatch(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	if limit <= 0 {
		limit = 100
	}
	if nil != ctx.Err() {
		return 0, ctx.Err()
	}

	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		// ClickHouse DELETE is a heavy mutation that rewrites data parts, so
		// per-batch mutations would be pathologically slow. Remove all matching
		// rows in a single synchronous mutation regardless of limit; the reported
		// count lets the caller's progress loop complete in one pass.
		total, err := CountOldLog(ctx, targetTimestamp)
		if err != nil {
			return 0, err
		}
		if total == 0 {
			return 0, nil
		}
		if err := LOG_DB.WithContext(ctx).Exec(
			"ALTER TABLE logs DELETE WHERE created_at < ? SETTINGS mutations_sync = 1",
			targetTimestamp,
		).Error; err != nil {
			return 0, err
		}
		return total, nil
	}

	result := LOG_DB.WithContext(ctx).Where("created_at < ?", targetTimestamp).Limit(limit).Delete(&Log{})
	if nil != result.Error {
		return 0, result.Error
	}
	return result.RowsAffected, nil
}

func DeleteOldLog(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	if limit <= 0 {
		limit = 100
	}

	var total int64 = 0

	for {
		if nil != ctx.Err() {
			return total, ctx.Err()
		}

		rowsAffected, err := DeleteOldLogBatch(ctx, targetTimestamp, limit)
		if nil != err {
			return total, err
		}

		total += rowsAffected

		if rowsAffected < int64(limit) {
			break
		}
	}

	return total, nil
}
