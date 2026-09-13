package dto

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestGeneralOpenAIRequestPreserveExplicitZeroValues(t *testing.T) {
	raw := []byte(`{
		"model":"gpt-4.1",
		"stream":false,
		"max_tokens":0,
		"max_completion_tokens":0,
		"top_p":0,
		"top_k":0,
		"n":0,
		"frequency_penalty":0,
		"presence_penalty":0,
		"seed":0,
		"logprobs":false,
		"top_logprobs":0,
		"dimensions":0,
		"return_images":false,
		"return_related_questions":false
	}`)

	var req GeneralOpenAIRequest
	err := common.Unmarshal(raw, &req)
	require.NoError(t, err)

	encoded, err := common.Marshal(req)
	require.NoError(t, err)

	require.True(t, gjson.GetBytes(encoded, "stream").Exists())
	require.True(t, gjson.GetBytes(encoded, "max_tokens").Exists())
	require.True(t, gjson.GetBytes(encoded, "max_completion_tokens").Exists())
	require.True(t, gjson.GetBytes(encoded, "top_p").Exists())
	require.True(t, gjson.GetBytes(encoded, "top_k").Exists())
	require.True(t, gjson.GetBytes(encoded, "n").Exists())
	require.True(t, gjson.GetBytes(encoded, "frequency_penalty").Exists())
	require.True(t, gjson.GetBytes(encoded, "presence_penalty").Exists())
	require.True(t, gjson.GetBytes(encoded, "seed").Exists())
	require.True(t, gjson.GetBytes(encoded, "logprobs").Exists())
	require.True(t, gjson.GetBytes(encoded, "top_logprobs").Exists())
	require.True(t, gjson.GetBytes(encoded, "dimensions").Exists())
	require.True(t, gjson.GetBytes(encoded, "return_images").Exists())
	require.True(t, gjson.GetBytes(encoded, "return_related_questions").Exists())
}

func TestOpenAIResponsesRequestPreserveExplicitZeroValues(t *testing.T) {
	raw := []byte(`{
		"model":"gpt-4.1",
		"max_output_tokens":0,
		"max_tool_calls":0,
		"stream":false,
		"top_p":0
	}`)

	var req OpenAIResponsesRequest
	err := common.Unmarshal(raw, &req)
	require.NoError(t, err)

	encoded, err := common.Marshal(req)
	require.NoError(t, err)

	require.True(t, gjson.GetBytes(encoded, "max_output_tokens").Exists())
	require.True(t, gjson.GetBytes(encoded, "max_tool_calls").Exists())
	require.True(t, gjson.GetBytes(encoded, "stream").Exists())
	require.True(t, gjson.GetBytes(encoded, "top_p").Exists())
}

func TestGeneralOpenAIRequestGetSystemRoleName(t *testing.T) {
	tests := []struct {
		name  string
		model string
		want  string
	}{
		{name: "o1 uses developer", model: "o1", want: "developer"},
		{name: "o3 family uses developer", model: "o3-mini-high", want: "developer"},
		{name: "o4 family uses developer", model: "o4-mini", want: "developer"},
		{name: "o1 mini stays system", model: "o1-mini", want: "system"},
		{name: "o1 preview stays system", model: "o1-preview", want: "system"},
		{name: "gpt 5 uses developer", model: "gpt-5", want: "developer"},
		{name: "gpt 5.6 uses developer", model: "gpt-5.6-luna", want: "developer"},
		{name: "gpt 6 uses developer", model: "gpt-6-astra", want: "developer"},
		{name: "gpt 6 snapshot uses developer", model: "gpt-6-astra-2026-09-03", want: "developer"},
		{name: "unknown gpt 6 variant stays system", model: "gpt-6-astra-pro", want: "system"},
		{name: "invalid gpt 6 snapshot stays system", model: "gpt-6-astra-2026-99-03", want: "system"},
		{name: "unknown generation stays system", model: "gpt-7", want: "system"},
		{name: "gpt 4.1 stays system", model: "gpt-4.1-nano", want: "system"},
		{name: "omni is not o series", model: "omni-moderation-latest", want: "system"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := GeneralOpenAIRequest{Model: tt.model}

			assert.Equal(t, tt.want, req.GetSystemRoleName())
		})
	}
}

func TestIsOpenAIGPT5Model(t *testing.T) {
	tests := []struct {
		model string
		want  bool
	}{
		{model: "gpt-5", want: true},
		{model: "gpt-5-mini", want: true},
		{model: "gpt-5-chat-latest", want: true},
		{model: "gpt-5.6-luna", want: true},
		{model: "gpt-5.4-nano", want: true},
		{model: "gpt-5.2-2025-12-11", want: true},
		{model: "gpt-6-astra", want: false},
		{model: "gpt-50", want: false},
		{model: "gpt-5custom", want: false},
		{model: "gpt-4.1", want: false},
		{model: "gpt-4o", want: false},
		{model: "gpt-oss-120b", want: false},
		{model: "gpt-image-2", want: false},
		{model: "o3-mini", want: false},
		{model: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			assert.Equal(t, tt.want, IsOpenAIGPT5Model(tt.model))
		})
	}
}

func TestGetOpenAIChatCapabilities(t *testing.T) {
	tests := []struct {
		name        string
		model       string
		effort      string
		maxTokens   bool
		developer   bool
		temperature bool
	}{
		{name: "unrecognized model keeps everything", model: "gpt-7", maxTokens: false, developer: false, temperature: true},
		{name: "gpt-4o keeps everything", model: "gpt-4o", maxTokens: false, developer: false, temperature: true},
		{name: "o model", model: "o3", maxTokens: true, developer: true, temperature: false},
		{name: "o1-mini no developer role", model: "o1-mini", maxTokens: true, developer: false, temperature: false},
		{name: "gpt-5 default effort drops sampling", model: "gpt-5", maxTokens: true, developer: true, temperature: false},
		{name: "gpt-5 with reasoning drops sampling", model: "gpt-5", effort: "medium", maxTokens: true, developer: true, temperature: false},
		{name: "gpt-5.1 without effort keeps sampling", model: "gpt-5.1", maxTokens: true, developer: true, temperature: true},
		{name: "gpt-5.1 snapshot without effort keeps sampling", model: "gpt-5.1-2025-11-13", maxTokens: true, developer: true, temperature: true},
		{name: "gpt-5.1 with reasoning drops sampling", model: "gpt-5.1", effort: "low", maxTokens: true, developer: true, temperature: false},
		{name: "gpt-5.6 never keeps sampling", model: "gpt-5.6-luna", maxTokens: true, developer: true, temperature: false},
		{name: "gpt-6-astra never keeps sampling", model: "gpt-6-astra", maxTokens: true, developer: true, temperature: false},
		{name: "gpt-6-astra snapshot never keeps sampling", model: "gpt-6-astra-2026-09-03", maxTokens: true, developer: true, temperature: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			capabilities := GetOpenAIChatCapabilities(tt.model, tt.effort)
			assert.Equal(t, tt.maxTokens, capabilities.UseMaxCompletionTokens)
			assert.Equal(t, tt.developer, capabilities.UseDeveloperRole)
			assert.Equal(t, tt.temperature, capabilities.SupportsTemperature)
		})
	}
}
