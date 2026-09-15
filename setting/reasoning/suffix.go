package reasoning

import (
	"strings"

	"github.com/samber/lo"
)

var EffortSuffixes = []string{"-max", "-xhigh", "-high", "-medium", "-low", "-minimal"}

var OpenAIEffortSuffixes = []string{"-high", "-minimal", "-low", "-medium", "-none", "-xhigh"}

// DeepSeekEffortSuffixes 覆盖官方思考模式的全部控制值：
// -none 关闭思考；其余为 reasoning_effort / reasoning.effort / output_config.effort 的合法取值，
// minimal/medium/xhigh/ultra 由 DeepSeek 上游按官方映射表归一到 low/high/max，这里原样透传。
var DeepSeekEffortSuffixes = []string{"-none", "-minimal", "-medium", "-xhigh", "-ultra", "-low", "-high", "-max"}

// TrimEffortSuffix -> modelName level(low) exists
func TrimEffortSuffix(modelName string) (string, string, bool) {
	return TrimEffortSuffixWithSuffixes(modelName, EffortSuffixes)
}

func TrimEffortSuffixWithSuffixes(modelName string, suffixes []string) (string, string, bool) {
	suffix, found := lo.Find(suffixes, func(s string) bool {
		return strings.HasSuffix(modelName, s)
	})
	if !found {
		return modelName, "", false
	}
	return strings.TrimSuffix(modelName, suffix), strings.TrimPrefix(suffix, "-"), true
}

func ParseOpenAIReasoningEffortFromModelSuffix(modelName string) (string, string) {
	baseModel, effort, ok := TrimEffortSuffixWithSuffixes(modelName, OpenAIEffortSuffixes)
	if !ok {
		return "", modelName
	}
	return effort, baseModel
}

// ParseDeepSeekThinkingSuffix 解析 DeepSeek 思考模式模型名后缀。
// 仅对 V4/V4.1 系列命名（deepseek-v4*，含官方现名 deepseek-flash）生效；
// deepseek-chat/deepseek-reasoner 属旧 V3 命名，思考开关由模型本身决定，不走后缀。
func ParseDeepSeekThinkingSuffix(modelName string) (baseModel string, thinkingType string, effort string, ok bool) {
	baseModel, suffix, ok := TrimEffortSuffixWithSuffixes(modelName, DeepSeekEffortSuffixes)
	if !ok || !(strings.HasPrefix(baseModel, "deepseek-v4") || strings.HasPrefix(baseModel, "deepseek-flash")) {
		return modelName, "", "", false
	}
	if suffix == "none" {
		return baseModel, "disabled", "", true
	}
	return baseModel, "enabled", suffix, true
}
