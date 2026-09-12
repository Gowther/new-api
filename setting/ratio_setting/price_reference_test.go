package ratio_setting

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// restoreMapAfter 在测试结束后恢复 RWMap 的原内容，避免测试间的全局状态串扰。
func restoreMapAfter[K comparable, V any](t *testing.T, m *types.RWMap[K, V]) {
	t.Helper()
	prev := m.ReadAll()
	t.Cleanup(func() {
		m.Clear()
		m.AddAll(prev)
	})
}

// bindModelsForTest 设置价格跟随绑定并在测试结束后恢复原状。
func bindModelsForTest(t *testing.T, bindings map[string]string) {
	t.Helper()
	prev := ModelPriceReference2JSONString()
	t.Cleanup(func() {
		require.NoError(t, UpdateModelPriceReferenceByJSONString(prev))
	})
	data, err := common.Marshal(bindings)
	require.NoError(t, err)
	require.NoError(t, UpdateModelPriceReferenceByJSONString(string(data)))
}

func TestUpdateModelPriceReferenceByJSONString(t *testing.T) {
	restoreMapAfter(t, modelPriceReferenceMap)

	require.Error(t, UpdateModelPriceReferenceByJSONString("not-json"))
	assert.Empty(t, modelPriceReferenceMap.ReadAll())

	require.NoError(t, UpdateModelPriceReferenceByJSONString(`{"alias-a":"src-a"}`))
	assert.Equal(t, map[string]string{"alias-a": "src-a"}, modelPriceReferenceMap.ReadAll())

	// 加载会整体替换而不是合并
	require.NoError(t, UpdateModelPriceReferenceByJSONString(`{}`))
	assert.Empty(t, modelPriceReferenceMap.ReadAll())
}

func TestHasPricedReference(t *testing.T) {
	bindModelsForTest(t, map[string]string{
		"ref-alias":        "ref-src",
		"ref-self":         "ref-self",
		"ref-blank":        "   ",
		"ref-chain-middle": "ref-chain-tail",
		"ref-chain-tail":   "ref-chain-tail",
	})

	hasPricing := func(model string) bool {
		return model == "ref-src" || model == "ref-chain-tail"
	}

	assert.True(t, HasPricedReference("ref-alias", hasPricing))
	assert.False(t, HasPricedReference("ref-self", hasPricing), "自引用不构成有效绑定")
	assert.False(t, HasPricedReference("ref-blank", hasPricing), "空白绑定不构成有效绑定")
	assert.False(t, HasPricedReference("ref-chain-tail", hasPricing), "绑定到自身视为无绑定")
	assert.False(t, HasPricedReference("ref-missing", hasPricing))
	assert.False(t, HasPricedReference("ref-alias", nil))
	// 链上源模型未定价时不视为已定价
	assert.False(t, HasPricedReference("ref-alias", func(string) bool { return false }))
}

func TestPriceReferenceChainCycleSafe(t *testing.T) {
	bindModelsForTest(t, map[string]string{
		"ref-cyc-a": "ref-cyc-b",
		"ref-cyc-b": "ref-cyc-a",
	})

	assert.Equal(t, []string{"ref-cyc-a", "ref-cyc-b"}, priceReferenceChain("ref-cyc-a"))
	assert.Equal(t, []string{"ref-cyc-b", "ref-cyc-a"}, priceReferenceChain("ref-cyc-b"))
}

func TestGetModelRatioFollowsReference(t *testing.T) {
	restoreMapAfter(t, modelRatioMap)
	prevSelfUseMode := operation_setting.SelfUseModeEnabled
	t.Cleanup(func() { operation_setting.SelfUseModeEnabled = prevSelfUseMode })
	operation_setting.SelfUseModeEnabled = false

	modelRatioMap.Set("ref-ratio-src", 1.25)
	modelRatioMap.Set("ref-ratio-mid", 2)
	modelRatioMap.Set("ref-ratio-own", 3)

	tests := []struct {
		name          string
		bindings      map[string]string
		model         string
		wantRatio     float64
		wantFound     bool
		wantMatchName string
	}{
		{
			name:          "follows source ratio",
			bindings:      map[string]string{"ref-ratio-alias": "ref-ratio-src"},
			model:         "ref-ratio-alias",
			wantRatio:     1.25,
			wantFound:     true,
			wantMatchName: "ref-ratio-alias",
		},
		{
			name:          "own ratio wins over source",
			bindings:      map[string]string{"ref-ratio-own": "ref-ratio-src"},
			model:         "ref-ratio-own",
			wantRatio:     3,
			wantFound:     true,
			wantMatchName: "ref-ratio-own",
		},
		{
			name:          "direct source own value shadows the chain",
			bindings:      map[string]string{"ref-ratio-head": "ref-ratio-mid", "ref-ratio-mid": "ref-ratio-src"},
			model:         "ref-ratio-head",
			wantRatio:     2,
			wantFound:     true,
			wantMatchName: "ref-ratio-head",
		},
		{
			name:          "follows through pass-through chain",
			bindings:      map[string]string{"ref-ratio-head": "ref-ratio-pass", "ref-ratio-pass": "ref-ratio-src"},
			model:         "ref-ratio-head",
			wantRatio:     1.25,
			wantFound:     true,
			wantMatchName: "ref-ratio-head",
		},
		{
			name:          "cycle falls back to unpriced",
			bindings:      map[string]string{"ref-ratio-cyc-a": "ref-ratio-cyc-b", "ref-ratio-cyc-b": "ref-ratio-cyc-a"},
			model:         "ref-ratio-cyc-a",
			wantRatio:     37.5,
			wantFound:     false,
			wantMatchName: "ref-ratio-cyc-a",
		},
		{
			name:          "unbound model stays unpriced",
			bindings:      map[string]string{},
			model:         "ref-ratio-none",
			wantRatio:     37.5,
			wantFound:     false,
			wantMatchName: "ref-ratio-none",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bindModelsForTest(t, tt.bindings)
			ratio, found, matchName := GetModelRatio(tt.model)
			assert.Equal(t, tt.wantRatio, ratio)
			assert.Equal(t, tt.wantFound, found)
			assert.Equal(t, tt.wantMatchName, matchName)
		})
	}
}

func TestGetModelPriceFollowsReference(t *testing.T) {
	restoreMapAfter(t, modelPriceMap)

	modelPriceMap.Set("ref-price-src", 0.1)
	modelPriceMap.Set("ref-price-own", 0.2)

	tests := []struct {
		name      string
		bindings  map[string]string
		model     string
		wantPrice float64
		wantFound bool
	}{
		{
			name:      "follows source price",
			bindings:  map[string]string{"ref-price-alias": "ref-price-src"},
			model:     "ref-price-alias",
			wantPrice: 0.1,
			wantFound: true,
		},
		{
			name:      "own price wins over source",
			bindings:  map[string]string{"ref-price-own": "ref-price-src"},
			model:     "ref-price-own",
			wantPrice: 0.2,
			wantFound: true,
		},
		{
			name:      "follows through chain",
			bindings:  map[string]string{"ref-price-head": "ref-price-mid", "ref-price-mid": "ref-price-src"},
			model:     "ref-price-head",
			wantPrice: 0.1,
			wantFound: true,
		},
		{
			name:      "source without price falls back to not found",
			bindings:  map[string]string{"ref-price-empty-alias": "ref-price-none"},
			model:     "ref-price-empty-alias",
			wantPrice: -1,
			wantFound: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bindModelsForTest(t, tt.bindings)
			price, found := GetModelPrice(tt.model, false)
			assert.Equal(t, tt.wantPrice, price)
			assert.Equal(t, tt.wantFound, found)
		})
	}
}

func TestGetCompletionRatioFollowsReference(t *testing.T) {
	restoreMapAfter(t, completionRatioMap)

	completionRatioMap.Set("ref-comp-own", 3)
	completionRatioMap.Set("vendor/ref-comp-model", 7)

	tests := []struct {
		name      string
		bindings  map[string]string
		model     string
		wantRatio float64
	}{
		{
			name:      "follows source hardcoded unlocked ratio",
			bindings:  map[string]string{"ref-comp-alias": "gpt-4o"},
			model:     "ref-comp-alias",
			wantRatio: 4,
		},
		{
			name:      "follows source locked hardcoded ratio",
			bindings:  map[string]string{"ref-comp-alias": "gpt-5"},
			model:     "ref-comp-alias",
			wantRatio: 8,
		},
		{
			name:      "own ratio wins over source",
			bindings:  map[string]string{"ref-comp-own": "gpt-5"},
			model:     "ref-comp-own",
			wantRatio: 3,
		},
		{
			name:      "follows vendor prefixed source custom ratio",
			bindings:  map[string]string{"ref-comp-vendor-alias": "vendor/ref-comp-model"},
			model:     "ref-comp-vendor-alias",
			wantRatio: 7,
		},
		{
			name:      "follows through chain",
			bindings:  map[string]string{"ref-comp-head": "ref-comp-mid", "ref-comp-mid": "gpt-5"},
			model:     "ref-comp-head",
			wantRatio: 8,
		},
		{
			name:      "unbound unknown model keeps fallback",
			bindings:  map[string]string{},
			model:     "ref-comp-none",
			wantRatio: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bindModelsForTest(t, tt.bindings)
			assert.Equal(t, tt.wantRatio, GetCompletionRatio(tt.model))
		})
	}
}

func TestGetCompletionRatioInfoFollowsReference(t *testing.T) {
	bindModelsForTest(t, map[string]string{
		"ref-info-locked":   "gpt-5",
		"ref-info-unlocked": "gpt-4o",
	})

	assert.Equal(t, CompletionRatioInfo{Ratio: 8, Locked: true}, GetCompletionRatioInfo("ref-info-locked"))
	assert.Equal(t, CompletionRatioInfo{Ratio: 4, Locked: false}, GetCompletionRatioInfo("ref-info-unlocked"))
}

func TestGetCacheRatioFollowsReference(t *testing.T) {
	restoreMapAfter(t, cacheRatioMap)
	restoreMapAfter(t, createCacheRatioMap)

	cacheRatioMap.Set("ref-cache-src", 0.5)
	createCacheRatioMap.Set("ref-cache-src", 0.9)
	bindModelsForTest(t, map[string]string{"ref-cache-alias": "ref-cache-src"})

	ratio, found := GetCacheRatio("ref-cache-alias")
	assert.Equal(t, 0.5, ratio)
	assert.True(t, found)

	ratio, found = GetCreateCacheRatio("ref-cache-alias")
	assert.Equal(t, 0.9, ratio)
	assert.True(t, found)

	// 未绑定模型保持默认值
	ratio, found = GetCacheRatio("ref-cache-none")
	assert.Equal(t, float64(1), ratio)
	assert.False(t, found)
	ratio, found = GetCreateCacheRatio("ref-cache-none")
	assert.Equal(t, 1.25, ratio)
	assert.False(t, found)
}

func TestGetImageRatioFollowsReference(t *testing.T) {
	restoreMapAfter(t, imageRatioMap)

	imageRatioMap.Set("ref-image-src", 2)
	bindModelsForTest(t, map[string]string{"ref-image-alias": "ref-image-src"})

	ratio, found := GetImageRatio("ref-image-alias")
	assert.Equal(t, float64(2), ratio)
	assert.True(t, found)

	ratio, found = GetImageRatio("ref-image-none")
	assert.Equal(t, float64(1), ratio)
	assert.False(t, found)
}

func TestAudioRatioFollowsReference(t *testing.T) {
	restoreMapAfter(t, audioRatioMap)
	restoreMapAfter(t, audioCompletionRatioMap)

	audioRatioMap.Set("ref-audio-src", 16)
	audioCompletionRatioMap.Set("ref-audio-src", 2)
	bindModelsForTest(t, map[string]string{"ref-audio-alias": "ref-audio-src"})

	assert.Equal(t, float64(16), GetAudioRatio("ref-audio-alias"))
	assert.True(t, ContainsAudioRatio("ref-audio-alias"))
	assert.Equal(t, float64(2), GetAudioCompletionRatio("ref-audio-alias"))
	assert.True(t, ContainsAudioCompletionRatio("ref-audio-alias"))

	assert.Equal(t, float64(1), GetAudioRatio("ref-audio-none"))
	assert.False(t, ContainsAudioRatio("ref-audio-none"))
	assert.False(t, ContainsAudioCompletionRatio("ref-audio-none"))
}
