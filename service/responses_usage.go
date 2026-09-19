package service

import (
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"strings"

	"github.com/gin-gonic/gin"
)

// ResponsesUsageAccumulator owns the accounting facts for one Responses
// generation over WebSocket. It mirrors the billing rules of the HTTP stream
// handler (relay/channel/openai OaiResponsesStreamHandler): usage comes from
// the terminal response event, output text deltas feed the missing-usage
// estimate, and built-in tool calls are counted on the relay info. Observe and
// Finish must be called by the same stream owner.
type ResponsesUsageAccumulator struct {
	c          *gin.Context
	info       *relaycommon.RelayInfo
	usage      *dto.Usage
	outputText strings.Builder
	started    bool
	failed     bool
	finished   bool
}

func NewResponsesUsageAccumulator(c *gin.Context, info *relaycommon.RelayInfo) *ResponsesUsageAccumulator {
	return &ResponsesUsageAccumulator{c: c, info: info, usage: &dto.Usage{}}
}

func (a *ResponsesUsageAccumulator) Observe(event *dto.ResponsesStreamResponse) {
	if a == nil || event == nil || a.finished {
		return
	}
	a.started = true
	switch event.Type {
	case "response.completed", "response.done", "response.failed", "response.incomplete", "response.cancelled", "response.canceled":
		if event.Response != nil {
			applyResponsesUsage(a.usage, event.Response.Usage)
			if a.outputText.Len() == 0 {
				// Some upstreams carry the output only on the terminal event.
				a.outputText.WriteString(extractResponsesOutputText(event.Response))
			}
		}
		if event.Type != "response.completed" && event.Type != "response.done" {
			a.failed = true
		}
	case "response.output_text.delta", "response.function_call_arguments.delta",
		"response.reasoning_summary_text.delta", "response.reasoning_text.delta", "response.refusal.delta":
		// Every delta kind here is generated output that upstream bills as
		// output tokens, so all of them feed the missing-usage estimate.
		a.outputText.WriteString(event.Delta)
	case dto.ResponsesOutputTypeItemDone:
		if event.Item == nil {
			return
		}
		switch event.Item.Type {
		case dto.BuildInCallWebSearchCall:
			if a.info != nil && a.info.ResponsesUsageInfo != nil && a.info.ResponsesUsageInfo.BuiltInTools != nil {
				if webSearchTool, exists := a.info.ResponsesUsageInfo.BuiltInTools[dto.BuildInToolWebSearchPreview]; exists && webSearchTool != nil {
					webSearchTool.CallCount++
				}
			}
		}
	}
	if event.Response != nil && event.Response.HasImageGenerationCall() {
		a.c.Set("image_generation_call", true)
		a.c.Set("image_generation_call_quality", event.Response.GetQuality())
		a.c.Set("image_generation_call_size", event.Response.GetSize())
	}
}

// Finish settles the accumulated usage. Like the HTTP stream handler, a stream
// that produced output but no usage is billed from the output text, and the
// prompt falls back to the pre-consume estimate unless upstream reported an
// explicit failure.
func (a *ResponsesUsageAccumulator) Finish() *dto.Usage {
	if a.finished {
		return a.usage
	}
	a.finished = true
	if a.usage.CompletionTokens == 0 {
		if output := a.outputText.String(); output != "" {
			a.usage.CompletionTokens = CountTextToken(output, a.info.UpstreamModelName)
		}
	}
	billsPrompt := a.usage.CompletionTokens != 0 || (a.started && !a.failed)
	if a.usage.PromptTokens == 0 && billsPrompt {
		a.usage.PromptTokens = a.info.GetEstimatePromptTokens()
	}
	a.usage.TotalTokens = a.usage.PromptTokens + a.usage.CompletionTokens
	return a.usage
}

// applyResponsesUsage merges an upstream usage report into dst with the same
// field mapping as the HTTP Responses handlers.
func applyResponsesUsage(dst *dto.Usage, src *dto.Usage) {
	if dst == nil || src == nil {
		return
	}
	if src.InputTokens != 0 {
		dst.PromptTokens = src.InputTokens
	}
	if src.OutputTokens != 0 {
		dst.CompletionTokens = src.OutputTokens
	}
	if src.TotalTokens != 0 {
		dst.TotalTokens = src.TotalTokens
	}
	if src.InputTokensDetails != nil {
		dst.PromptTokensDetails.CachedTokens = src.InputTokensDetails.CachedTokens
	}
}

// extractResponsesOutputText flattens the message/output_text items of a
// terminal response for the missing-usage estimate.
func extractResponsesOutputText(response *dto.OpenAIResponsesResponse) string {
	if response == nil {
		return ""
	}
	var builder strings.Builder
	for i := range response.Output {
		item := &response.Output[i]
		if item == nil {
			continue
		}
		for _, content := range item.Content {
			if content.Text != "" {
				builder.WriteString(content.Text)
			}
		}
	}
	return builder.String()
}
