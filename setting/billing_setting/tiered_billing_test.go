package billing_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// restoreBillingMapsForTest 在测试结束后恢复计费模式与表达式配置。
func restoreBillingMapsForTest(t *testing.T) {
	t.Helper()
	prevMode := make(map[string]string, len(billingSetting.BillingMode))
	for k, v := range billingSetting.BillingMode {
		prevMode[k] = v
	}
	prevExpr := make(map[string]string, len(billingSetting.BillingExpr))
	for k, v := range billingSetting.BillingExpr {
		prevExpr[k] = v
	}
	t.Cleanup(func() {
		billingSetting.BillingMode = prevMode
		billingSetting.BillingExpr = prevExpr
	})
}

// bindPriceReferenceForTest 设置价格跟随绑定并在测试结束后恢复原状。
func bindPriceReferenceForTest(t *testing.T, bindings map[string]string) {
	t.Helper()
	prev := ratio_setting.ModelPriceReference2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelPriceReferenceByJSONString(prev))
	})
	data, err := common.Marshal(bindings)
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateModelPriceReferenceByJSONString(string(data)))
}

func TestGetBillingModeAndExprFollowReference(t *testing.T) {
	restoreBillingMapsForTest(t)

	const sourceExpr = `tier("base", p * 3 + c * 15)`
	billingSetting.BillingMode["tiered-src"] = BillingModeTieredExpr
	billingSetting.BillingExpr["tiered-src"] = sourceExpr
	billingSetting.BillingMode["tiered-own"] = BillingModeTieredExpr
	billingSetting.BillingExpr["tiered-own"] = `tier("own", p * 9)`

	tests := []struct {
		name        string
		bindings    map[string]string
		model       string
		wantMode    string
		wantExpr    string
		wantHasExpr bool
	}{
		{
			name:        "alias follows tiered source",
			bindings:    map[string]string{"tiered-alias": "tiered-src"},
			model:       "tiered-alias",
			wantMode:    BillingModeTieredExpr,
			wantExpr:    sourceExpr,
			wantHasExpr: true,
		},
		{
			name:        "own config wins over source",
			bindings:    map[string]string{"tiered-own": "tiered-src"},
			model:       "tiered-own",
			wantMode:    BillingModeTieredExpr,
			wantExpr:    `tier("own", p * 9)`,
			wantHasExpr: true,
		},
		{
			name:        "follows through pass-through chain",
			bindings:    map[string]string{"tiered-head": "tiered-mid", "tiered-mid": "tiered-src"},
			model:       "tiered-head",
			wantMode:    BillingModeTieredExpr,
			wantExpr:    sourceExpr,
			wantHasExpr: true,
		},
		{
			name:        "unbound model keeps ratio default",
			bindings:    map[string]string{},
			model:       "tiered-none",
			wantMode:    BillingModeRatio,
			wantExpr:    "",
			wantHasExpr: false,
		},
		{
			name:        "cycle falls back to ratio default",
			bindings:    map[string]string{"tiered-cyc-a": "tiered-cyc-b", "tiered-cyc-b": "tiered-cyc-a"},
			model:       "tiered-cyc-a",
			wantMode:    BillingModeRatio,
			wantExpr:    "",
			wantHasExpr: false,
		},
		{
			name:        "source without tiered config keeps ratio default",
			bindings:    map[string]string{"tiered-empty-alias": "tiered-none"},
			model:       "tiered-empty-alias",
			wantMode:    BillingModeRatio,
			wantExpr:    "",
			wantHasExpr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bindPriceReferenceForTest(t, tt.bindings)
			assert.Equal(t, tt.wantMode, GetBillingMode(tt.model))
			expr, ok := GetBillingExpr(tt.model)
			assert.Equal(t, tt.wantExpr, expr)
			assert.Equal(t, tt.wantHasExpr, ok)
		})
	}
}
