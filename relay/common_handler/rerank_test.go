package common_handler

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRerankHandlerXinferenceOutOfRangeIndex pins the contract that an
// upstream-controlled result index beyond the requested documents must not
// panic (info.Documents[result.Index]); the handler falls back to the
// upstream-provided document instead.
func TestRerankHandlerXinferenceOutOfRangeIndex(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	body := `{"results":[{"index":10,"relevance_score":0.9,"document":""}]}`
	resp := &http.Response{Body: io.NopCloser(strings.NewReader(body))}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeXinference},
		RerankerInfo: &relaycommon.RerankerInfo{
			Documents:       []any{"doc0"},
			ReturnDocuments: true,
		},
	}

	usage, apiErr := RerankHandler(c, info, resp)
	require.Nil(t, apiErr)
	require.NotNil(t, usage)
	assert.Equal(t, http.StatusOK, recorder.Code)

	var jinaResp dto.RerankResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &jinaResp))
	require.Len(t, jinaResp.Results, 1)
	assert.Equal(t, 10, jinaResp.Results[0].Index)
}

// TestRerankHandlerXinferenceValidIndex ensures the bounds check does not
// break the normal in-range document mapping.
func TestRerankHandlerXinferenceValidIndex(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	body := `{"results":[{"index":1,"relevance_score":0.5,"document":""}]}`
	resp := &http.Response{Body: io.NopCloser(strings.NewReader(body))}
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeXinference},
		RerankerInfo: &relaycommon.RerankerInfo{
			Documents:       []any{"doc0", "doc1"},
			ReturnDocuments: true,
		},
	}

	usage, apiErr := RerankHandler(c, info, resp)
	require.Nil(t, apiErr)
	require.NotNil(t, usage)

	var jinaResp dto.RerankResponse
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &jinaResp))
	require.Len(t, jinaResp.Results, 1)
	assert.Equal(t, "doc1", jinaResp.Results[0].Document)
}
