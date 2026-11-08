package service

import (
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service/relayconvert"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCacheWriteAliasesSurviveConversionAndBilling(t *testing.T) {
	for _, tc := range []struct {
		fields               string
		wantWrite, wantQuota int
	}{
		{`"cached_creation_tokens":100`, 100, 1025},
		{`"cache_write_tokens":100`, 100, 1025},
		{`"cache_creation_input_tokens":100`, 100, 1025},
		{`"cached_creation_tokens":100,"cache_write_tokens":200,"cache_creation_input_tokens":300`, 300, 1075},
		{`"cache_creation_input_tokens":-100`, 0, 1000},
	} {
		t.Run(tc.fields, func(t *testing.T) {
			var chat dto.Usage
			require.NoError(t, common.UnmarshalJsonStr(fmt.Sprintf(`{"prompt_tokens":1000,"total_tokens":1000,"prompt_tokens_details":{%s}}`, tc.fields), &chat))
			assert.Equal(t, tc.wantWrite, chat.PromptTokensDetails.CacheCreationTokensTotal())
			responses := relayconvert.UsageFromChatUsage(&chat)
			var streamed dto.Usage
			applyResponsesUsage(&streamed, responses)
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			info := &relaycommon.RelayInfo{PriceData: types.PriceData{
				ModelRatio: 1, CacheCreationRatio: 1.25, GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1},
			}}
			for _, usage := range []*dto.Usage{&chat, &streamed} {
				assert.Equal(t, tc.wantQuota, calculateTextQuotaSummary(ctx, info, usage).Quota)
				params := BuildTieredTokenParams(usage, false, billingexpr.UsedVars(`p + cc`))
				assert.Equal(t, float64(1000-tc.wantWrite), params.P)
				assert.Equal(t, float64(tc.wantWrite), params.CC)
			}
		})
	}
}
