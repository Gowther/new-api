package gemini

import (
	"fmt"
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

func TestEmbeddingUsesUpstreamUsageWhenAvailable(t *testing.T) {
	for _, mode := range []string{"native-single", "native-batch", "openai"} {
		for _, tc := range []struct {
			metadata string
			want     int
		}{
			{`,"usageMetadata":{"promptTokenCount":42,"promptTokenDetails":[{"modality":"TEXT","tokenCount":42}]}`, 42},
			{"", 120},
			{`,"usageMetadata":{"promptTokenCount":0}`, 120},
		} {
			t.Run(fmt.Sprintf("%s/%d/%s", mode, tc.want, tc.metadata), func(t *testing.T) {
				data := `{"embeddings":[{"values":[0.1,0.2]}]` + tc.metadata + `}`
				if mode == "native-single" {
					data = `{"embedding":{"values":[0.1,0.2]}` + tc.metadata + `}`
				}
				writer := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(writer)
				c.Request = httptest.NewRequest(http.MethodPost, "/embeddings", nil)
				info := &relaycommon.RelayInfo{IsGeminiBatchEmbedding: mode != "native-single", ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "gemini-embedding-test"}}
				info.SetEstimatePromptTokens(120)
				resp := &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(data))}
				var usage *dto.Usage
				if mode == "openai" {
					value, err := GeminiEmbeddingHandler(c, info, resp)
					require.Nil(t, err)
					usage = value
					var body dto.OpenAIEmbeddingResponse
					require.NoError(t, common.Unmarshal(writer.Body.Bytes(), &body))
					assert.Equal(t, tc.want, body.Usage.PromptTokens)
					require.Len(t, body.Data, 1)
				} else {
					value, err := NativeGeminiEmbeddingHandler(c, resp, info)
					require.Nil(t, err)
					usage = value
					assert.JSONEq(t, data, writer.Body.String())
				}
				require.NotNil(t, usage)
				assert.Equal(t, tc.want, usage.PromptTokens)
				assert.Equal(t, tc.want, usage.TotalTokens)
				assert.Zero(t, usage.CompletionTokens)
				if tc.want == 42 {
					assert.Equal(t, 42, usage.PromptTokensDetails.TextTokens)
				}
			})
		}
	}
}
