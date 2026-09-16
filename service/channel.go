package service

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"
)

func formatNotifyType(channelId int, status int) string {
	return fmt.Sprintf("%s_%d_%d", dto.NotifyTypeChannelUpdate, channelId, status)
}

// disable & notify
func DisableChannel(channelError types.ChannelError, reason string) {
	common.SysLog(fmt.Sprintf("通道「%s」（#%d）发生错误，准备禁用，原因：%s", channelError.ChannelName, channelError.ChannelId, common.LocalLogPreview(reason)))

	// 检查渠道是否允许自动禁用（0 = 强制关闭）
	if channelError.AutoBanMode == model.ChannelAutoBanForceOff {
		common.SysLog(fmt.Sprintf("通道「%s」（#%d）未启用自动禁用功能，跳过禁用操作", channelError.ChannelName, channelError.ChannelId))
		return
	}

	success := model.UpdateChannelStatus(channelError.ChannelId, channelError.UsingKey, common.ChannelStatusAutoDisabled, reason)
	if success {
		subject := fmt.Sprintf("通道「%s」（#%d）已被禁用", channelError.ChannelName, channelError.ChannelId)
		content := fmt.Sprintf("通道「%s」（#%d）已被禁用，原因：%s", channelError.ChannelName, channelError.ChannelId, reason)
		NotifyRootUser(formatNotifyType(channelError.ChannelId, common.ChannelStatusAutoDisabled), subject, content)
	}
}

func EnableChannel(channelId int, usingKey string, channelName string) {
	success := model.UpdateChannelStatus(channelId, usingKey, common.ChannelStatusEnabled, "")
	if success {
		subject := fmt.Sprintf("通道「%s」（#%d）已被启用", channelName, channelId)
		content := fmt.Sprintf("通道「%s」（#%d）已被启用", channelName, channelId)
		NotifyRootUser(formatNotifyType(channelId, common.ChannelStatusEnabled), subject, content)
	}
}

// ShouldDisableChannelWithRules decides whether a channel error should disable
// the channel. autoBanMode: 0 = force off, 1 = follow the global
// AutomaticDisableChannelEnabled switch, 2 = force on. When rules is non-nil it
// completely replaces the global status-code list and keyword list; nil falls
// back to the global rules.
func ShouldDisableChannelWithRules(err *types.NewAPIError, autoBanMode int, rules *types.ChannelAutoBanRules) bool {
	enabled := autoBanMode == model.ChannelAutoBanForceOn ||
		(autoBanMode != model.ChannelAutoBanForceOff && common.AutomaticDisableChannelEnabled)
	if !enabled || err == nil {
		return false
	}
	if types.IsChannelError(err) {
		return true
	}
	if types.IsSkipRetryError(err) {
		return false
	}
	if rules != nil {
		if ranges, rangeErr := operation_setting.ParseHTTPStatusCodeRanges(rules.StatusCodes); rangeErr == nil {
			if operation_setting.MatchStatusCodeRanges(ranges, err.StatusCode) {
				return true
			}
		} else {
			common.SysError(fmt.Sprintf("invalid channel auto-ban status code rules, fallback to keywords only: %s", rangeErr.Error()))
		}
		lowerMessage := strings.ToLower(err.Error())
		keywords := make([]string, 0, len(rules.Keywords))
		for _, k := range rules.Keywords {
			k = strings.ToLower(strings.TrimSpace(k))
			if k != "" {
				keywords = append(keywords, k)
			}
		}
		search, _ := AcSearch(lowerMessage, keywords, true)
		return search
	}
	if operation_setting.ShouldDisableByStatusCode(err.StatusCode) {
		return true
	}

	lowerMessage := strings.ToLower(err.Error())
	search, _ := AcSearch(lowerMessage, operation_setting.AutomaticDisableKeywords, true)
	return search
}

// ShouldEnableChannel decides whether a successful probe may re-enable an
// auto-disabled channel. autoTestMode: 0 = force off (the channel is never
// probed, so it also never auto-recovers), 1 = follow the global
// AutomaticEnableChannelEnabled switch, 2 = force on (a successful probe
// re-enables the channel even when every global switch is off).
func ShouldEnableChannel(newAPIError *types.NewAPIError, status int, autoTestMode int) bool {
	if autoTestMode == model.ChannelAutoTestForceOff {
		return false
	}
	if newAPIError != nil {
		return false
	}
	if status != common.ChannelStatusAutoDisabled {
		return false
	}
	if autoTestMode == model.ChannelAutoTestForceOn {
		return true
	}
	return common.AutomaticEnableChannelEnabled
}
