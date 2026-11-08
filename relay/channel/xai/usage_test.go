package xai

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStreamRetainsUpstreamUsageDetails(t *testing.T) {
	const payload = `{"id":"test","choices":[],"usage":{"prompt_tokens":100,"completion_tokens":5,"total_tokens":150,"prompt_tokens_details":{"cached_tokens":80,"cache_write_tokens":10},"completion_tokens_details":{"reasoning_tokens":45,"text_tokens":5}}}`
	writer := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(writer)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	info := &relaycommon.RelayInfo{DisablePing: true, ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "grok-test"}}
	resp := &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("data: " + payload + "\n\ndata: [DONE]\n\n"))}
	usage, err := xAIStreamHandler(c, info, resp)
	require.Nil(t, err)
	require.NotNil(t, usage)
	assert.Equal(t, 50, usage.CompletionTokens)
	assert.Equal(t, 80, usage.PromptTokensDetails.CachedTokens)
	assert.Equal(t, 10, usage.PromptTokensDetails.CacheWriteTokens)
	assert.Equal(t, 45, usage.CompletionTokenDetails.ReasoningTokens)
	var forwarded dto.ChatCompletionsStreamResponse
	first := strings.Split(writer.Body.String(), "\n")[0]
	require.NoError(t, common.UnmarshalJsonStr(strings.TrimPrefix(first, "data: "), &forwarded))
	require.NotNil(t, forwarded.Usage)
	assert.Equal(t, *usage, *forwarded.Usage)
}
