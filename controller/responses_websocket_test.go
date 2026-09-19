package controller

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	appmodel "github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseResponsesWSEnvelope(t *testing.T) {
	tests := []struct {
		name         string
		message      string
		wantType     string
		wantStreamID string
		wantErr      bool
	}{
		{
			name:     "create event without stream id",
			message:  `{"type":"response.create","response":{"model":"gpt-5"}}`,
			wantType: "response.create",
		},
		{
			name:         "create event with top level stream id",
			message:      `{"type":"response.create","stream_id":"s-1.2_3","response":{"model":"gpt-5"}}`,
			wantType:     "response.create",
			wantStreamID: "s-1.2_3",
		},
		{
			name:         "wrapped stream id is honored",
			message:      `{"type":"response.create","response":{"model":"gpt-5","stream_id":"wrapped"}}`,
			wantType:     "response.create",
			wantStreamID: "wrapped",
		},
		{
			name:         "top level stream id wins over wrapped",
			message:      `{"type":"response.create","stream_id":"outer","response":{"model":"gpt-5","stream_id":"inner"}}`,
			wantType:     "response.create",
			wantStreamID: "outer",
		},
		{
			name:    "missing event type",
			message: `{"response":{"model":"gpt-5"}}`,
			wantErr: true,
		},
		{
			name:    "stream id with invalid characters",
			message: `{"type":"response.create","stream_id":"bad id!","response":{}}`,
			wantErr: true,
		},
		{
			name:    "stream id too long",
			message: `{"type":"response.create","stream_id":"` + strings.Repeat("a", 300) + `","response":{}}`,
			wantErr: true,
		},
		{
			name:    "invalid json",
			message: `{"type":`,
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			envelope, streamID, err := parseResponsesWSEnvelope([]byte(tt.message))
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.wantType, envelope.Type)
			assert.Equal(t, tt.wantStreamID, streamID)
		})
	}
}

func TestNormalizeResponsesWSCreateEvent(t *testing.T) {
	t.Run("unwrapped body strips envelope fields", func(t *testing.T) {
		envelope, streamID, err := parseResponsesWSEnvelope([]byte(`{"type":"response.create","event_id":"e1","stream":"true","stream_options":{},"response":{"model":"gpt-5","input":"hi"}}`))
		require.NoError(t, err)
		create, err := normalizeResponsesWSCreateEvent([]byte(envelope.Request), envelope, streamID)
		require.NoError(t, err)
		assert.Equal(t, "gpt-5", create.Request.Model)
		var raw map[string]common.RawMessage
		require.NoError(t, common.Unmarshal(create.Body, &raw))
		assert.NotContains(t, raw, "type")
		assert.NotContains(t, raw, "event_id")
		assert.NotContains(t, raw, "stream")
		assert.NotContains(t, raw, "stream_options")
		assert.Nil(t, create.Request.Stream)
		assert.Nil(t, create.Request.StreamOptions)
	})

	t.Run("generate field is carried through", func(t *testing.T) {
		envelope, streamID, err := parseResponsesWSEnvelope([]byte(`{"type":"response.create","generate":{"kind":"x"},"response":{"model":"gpt-5"}}`))
		require.NoError(t, err)
		create, err := normalizeResponsesWSCreateEvent([]byte(`{"type":"response.create","generate":{"kind":"x"},"response":{"model":"gpt-5"}}`), envelope, streamID)
		require.NoError(t, err)
		require.JSONEq(t, `{"kind":"x"}`, string(create.Generate))
	})

	t.Run("max_output_tokens above the billing bound is rejected", func(t *testing.T) {
		envelope, streamID, err := parseResponsesWSEnvelope([]byte(`{"type":"response.create","response":{"model":"gpt-5","max_output_tokens":18446744073709551615}}`))
		require.NoError(t, err)
		_, err = normalizeResponsesWSCreateEvent([]byte(envelope.Request), envelope, streamID)
		require.Error(t, err)
	})
}

func TestBuildResponsesWSCreateEvent(t *testing.T) {
	payload, err := buildResponsesWSCreateEvent([]byte(`{"model":"gpt-5","stream_id":"leaked","input":"hi"}`), common.RawMessage(`{"kind":"x"}`), "s-1")
	require.NoError(t, err)
	var event map[string]common.RawMessage
	require.NoError(t, common.Unmarshal(payload, &event))
	assert.JSONEq(t, `"response.create"`, string(event["type"]))
	assert.JSONEq(t, `"s-1"`, string(event["stream_id"]))
	assert.JSONEq(t, `{"kind":"x"}`, string(event["generate"]))
	assert.NotContains(t, event, "event_id")
	assert.NotContains(t, event, "background")
}

func TestResponsesWSErrorEndsRequest(t *testing.T) {
	tests := []struct {
		name             string
		event            responsesWSErrorEvent
		streamID         string
		responseID       string
		control          []byte
		wantTerminal     bool
		wantControlError bool
	}{
		{
			name:         "uncorrelated stream error does not end the request",
			event:        responsesWSErrorEvent{StreamID: "other", Error: wsErr("server_error")},
			streamID:     "s-1",
			responseID:   "resp-1",
			wantTerminal: false,
		},
		{
			name:         "matching stream error ends the request",
			event:        responsesWSErrorEvent{StreamID: "s-1", Error: wsErr("server_error")},
			streamID:     "s-1",
			responseID:   "resp-1",
			wantTerminal: true,
		},
		{
			name:             "cancel rejection matching the pending control is a control error",
			event:            responsesWSErrorEvent{EventID: "evt-1", Error: wsErr("invalid_request_error")},
			control:          []byte(`{"event_id":"evt-1"}`),
			wantControlError: true,
		},
		{
			name:         "cancel rejection with an unrelated id leaves the generation stuck",
			event:        responsesWSErrorEvent{EventID: "evt-2", Error: wsErr("invalid_request_error")},
			control:      []byte(`{"event_id":"evt-1"}`),
			wantTerminal: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			terminal, _, controlError := responsesWSErrorEndsRequest(tt.event, tt.streamID, tt.responseID, tt.control)
			assert.Equal(t, tt.wantTerminal, terminal)
			assert.Equal(t, tt.wantControlError, controlError)
		})
	}
}

func wsErr(code string) *types.OpenAIError {
	return &types.OpenAIError{Type: "invalid_request_error", Code: code}
}

func TestResponsesWSChannelFilter(t *testing.T) {
	enabled := func(v bool) *string {
		raw := "false"
		if v {
			raw = "true"
		}
		setting := `{"responses_websocket_enabled":` + raw + `}`
		return &setting
	}
	tests := []struct {
		name    string
		channel *appmodel.Channel
		want    bool
	}{
		{
			name:    "openai channel with toggle on",
			channel: &appmodel.Channel{Id: 1, Type: constant.ChannelTypeOpenAI, Setting: enabled(true)},
			want:    true,
		},
		{
			name:    "openai channel with toggle off",
			channel: &appmodel.Channel{Id: 1, Type: constant.ChannelTypeOpenAI, Setting: enabled(false)},
			want:    false,
		},
		{
			name:    "sub2api channel with toggle on",
			channel: &appmodel.Channel{Id: 2, Type: constant.ChannelTypeSub2API, Setting: enabled(true)},
			want:    true,
		},
		{
			name:    "new api channel with toggle on",
			channel: &appmodel.Channel{Id: 3, Type: constant.ChannelTypeNewAPI, Setting: enabled(true)},
			want:    true,
		},
		{
			name:    "unsupported channel type with toggle on",
			channel: &appmodel.Channel{Id: 4, Type: constant.ChannelTypeAnthropic, Setting: enabled(true)},
			want:    false,
		},
		{
			name: "advanced custom with converter-free responses route",
			channel: &appmodel.Channel{
				Id: 5, Type: constant.ChannelTypeAdvancedCustom, Setting: enabled(true),
				OtherSettings: `{"advanced_custom":{"advanced_routes":[{"incoming_path":"/v1/responses","upstream_path":"/v1/responses","converter":"none"}]}}`,
			},
			want: true,
		},
		{
			name: "advanced custom with converting responses route",
			channel: &appmodel.Channel{
				Id: 6, Type: constant.ChannelTypeAdvancedCustom, Setting: enabled(true),
				OtherSettings: `{"advanced_custom":{"advanced_routes":[{"incoming_path":"/v1/responses","upstream_path":"https://upstream/v1/chat/completions","converter":"openai_responses_to_openai_chat_completions"}]}}`,
			},
			want: false,
		},
	}
	filter := responsesWSChannelFilter()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, filter(tt.channel))
		})
	}
}
