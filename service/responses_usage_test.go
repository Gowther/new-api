package service

import (
	"testing"

	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newResponsesUsageTestContext(t *testing.T) (*gin.Context, *relaycommon.RelayInfo) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(nil)
	// Use a non-OpenAI model name so Finish's output estimate takes the
	// deterministic estimator path instead of the tiktoken encoder.
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "mock-model"}}
	info.SetEstimatePromptTokens(123)
	return c, info
}

func TestResponsesUsageAccumulatorTerminalUsage(t *testing.T) {
	c, info := newResponsesUsageTestContext(t)
	accumulator := NewResponsesUsageAccumulator(c, info)

	accumulator.Observe(&dto.ResponsesStreamResponse{Type: "response.output_text.delta", Delta: "ignored when usage reported"})
	accumulator.Observe(&dto.ResponsesStreamResponse{
		Type: "response.completed",
		Response: &dto.OpenAIResponsesResponse{
			ID: "resp-1",
			Usage: &dto.Usage{
				InputTokens:        20,
				OutputTokens:       7,
				TotalTokens:        27,
				InputTokensDetails: &dto.InputTokenDetails{CachedTokens: 5},
			},
		},
	})

	usage := accumulator.Finish()
	assert.Equal(t, 20, usage.PromptTokens)
	assert.Equal(t, 7, usage.CompletionTokens)
	assert.Equal(t, 27, usage.TotalTokens)
	assert.Equal(t, 5, usage.PromptTokensDetails.CachedTokens)
}

func TestResponsesUsageAccumulatorPromptFallbackWithoutUsage(t *testing.T) {
	c, info := newResponsesUsageTestContext(t)
	accumulator := NewResponsesUsageAccumulator(c, info)

	accumulator.Observe(&dto.ResponsesStreamResponse{Type: "response.created", Response: &dto.OpenAIResponsesResponse{ID: "resp-1"}})
	accumulator.Observe(&dto.ResponsesStreamResponse{Type: "response.output_text.delta", Delta: "hi"})

	usage := accumulator.Finish()
	// The stream never reported usage, so the estimate covers the prompt.
	assert.Equal(t, 123, usage.PromptTokens)
}

func TestResponsesUsageAccumulatorFailedTerminalSkipsPromptEstimate(t *testing.T) {
	c, info := newResponsesUsageTestContext(t)
	accumulator := NewResponsesUsageAccumulator(c, info)

	accumulator.Observe(&dto.ResponsesStreamResponse{Type: "response.created", Response: &dto.OpenAIResponsesResponse{ID: "resp-1"}})
	accumulator.Observe(&dto.ResponsesStreamResponse{Type: "response.failed", Response: &dto.OpenAIResponsesResponse{ID: "resp-1"}})

	usage := accumulator.Finish()
	assert.Equal(t, 0, usage.PromptTokens)
	assert.Equal(t, 0, usage.CompletionTokens)
}

func TestResponsesUsageAccumulatorFlagsImageGenerationCall(t *testing.T) {
	c, info := newResponsesUsageTestContext(t)
	accumulator := NewResponsesUsageAccumulator(c, info)

	accumulator.Observe(&dto.ResponsesStreamResponse{
		Type: "response.completed",
		Response: &dto.OpenAIResponsesResponse{
			ID:     "resp-1",
			Output: []dto.ResponsesOutput{{Type: dto.ResponsesOutputTypeImageGenerationCall, Quality: "high", Size: "1024x1024"}},
			Usage:  &dto.Usage{InputTokens: 1, OutputTokens: 1, TotalTokens: 2},
		},
	})

	accumulator.Finish()
	assert.Equal(t, true, c.GetBool("image_generation_call"))
	assert.Equal(t, "high", c.GetString("image_generation_call_quality"))
	assert.Equal(t, "1024x1024", c.GetString("image_generation_call_size"))
}

func TestApplyResponsesUsageKeepsZeroValuesFromUpstream(t *testing.T) {
	dst := &dto.Usage{PromptTokens: 1, CompletionTokens: 1}
	applyResponsesUsage(dst, &dto.Usage{InputTokens: 10, OutputTokens: 0, TotalTokens: 10})
	assert.Equal(t, 10, dst.PromptTokens)
	// A zero output_tokens from upstream must not overwrite a non-zero value.
	assert.Equal(t, 1, dst.CompletionTokens)
	require.NotNil(t, dst)
}
