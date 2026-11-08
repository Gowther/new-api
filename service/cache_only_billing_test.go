package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClaudeCacheOnlyUsageRemainsBillable(t *testing.T) {
	for _, tc := range []struct {
		name                                string
		read, total, split5m, split1h, want int
	}{
		{"read only", 100, 0, 0, 0, 10},
		{"write only", 0, 100, 0, 0, 125},
		{"one-hour write", 0, 100, 0, 100, 200},
		{"split without aggregate", 0, 0, 40, 60, 170},
		{"empty response", 0, 0, 0, 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			info := &relaycommon.RelayInfo{RelayFormat: types.RelayFormatClaude, PriceData: types.PriceData{
				ModelRatio: 1, CompletionRatio: 5, CacheRatio: 0.1,
				CacheCreationRatio: 1.25, CacheCreation5mRatio: 1.25, CacheCreation1hRatio: 2,
				GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1},
			}}
			usage := &dto.Usage{UsageSemantic: "anthropic",
				PromptTokensDetails:         dto.InputTokenDetails{CachedTokens: tc.read, CachedCreationTokens: tc.total},
				ClaudeCacheCreation5mTokens: tc.split5m, ClaudeCacheCreation1hTokens: tc.split1h,
			}
			summary := calculateTextQuotaSummary(ctx, info, usage)
			assert.Equal(t, tc.want, summary.Quota)
			assert.Equal(t, tc.want > 0, summary.hasBillableUsage())
			assert.Zero(t, summary.TotalTokens)
		})
	}
}

func TestTieredSettlementIncludesUnsplitClaudeCacheWrites(t *testing.T) {
	const expr = `tier("base", p * 3 + c * 15 + cr * 0.3 + cc * 4 + cc1h * 6)`
	for _, semantic := range []string{"", "anthropic"} {
		for _, tc := range []struct {
			split1h   int
			wantQuota int
		}{{0, 20000}, {4000, 24000}} {
			usage := &dto.Usage{UsageSemantic: semantic, PromptTokensDetails: dto.InputTokenDetails{CachedCreationTokens: 10000}, ClaudeCacheCreation1hTokens: tc.split1h}
			params := BuildTieredTokenParams(usage, true, billingexpr.UsedVars(expr))
			assert.Equal(t, float64(10000), params.Len)
			assert.Equal(t, float64(10000-tc.split1h), params.CC)
			assert.Equal(t, float64(tc.split1h), params.CC1h)
			ok, quota, result := TryTieredSettle(makeRelayInfo(expr, 1, 12000, 100), params)
			require.True(t, ok)
			require.NotNil(t, result)
			assert.Equal(t, tc.wantQuota, quota)
		}
	}
}
