/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package controller

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"github.com/QuantumNous/new-api/setting/billing_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func floatPtr(v float64) *float64 { return &v }

func TestBuildModelsDevCandidateParsesCacheWriteAndTiers(t *testing.T) {
	candidate, ok := buildModelsDevCandidate("openai", modelsDevCost{
		Input:      floatPtr(10),
		Output:     floatPtr(50),
		CacheRead:  floatPtr(1),
		CacheWrite: floatPtr(12.5),
		Tiers: []modelsDevTier{
			{
				Input:      floatPtr(20),
				Output:     floatPtr(75),
				CacheRead:  floatPtr(2),
				CacheWrite: floatPtr(25),
				Tier: struct {
					Type string `json:"type"`
					Size int64  `json:"size"`
				}{Type: "context", Size: 272000},
			},
		},
	})

	require.True(t, ok)
	require.NotNil(t, candidate.CacheWrite)
	assert.Equal(t, 12.5, *candidate.CacheWrite)
	require.Len(t, candidate.Tiers, 1)
	assert.Equal(t, int64(272000), candidate.Tiers[0].Size)
	assert.Equal(t, 20.0, candidate.Tiers[0].Input)
	require.NotNil(t, candidate.Tiers[0].CacheWrite)
	assert.Equal(t, 25.0, *candidate.Tiers[0].CacheWrite)
}

func TestBuildModelsDevCandidateDropsUnusableTiers(t *testing.T) {
	validTier := modelsDevTier{
		Input:  floatPtr(20),
		Output: floatPtr(75),
		Tier: struct {
			Type string `json:"type"`
			Size int64  `json:"size"`
		}{Type: "context", Size: 272000},
	}
	withType := func(tier modelsDevTier, tierType string) modelsDevTier {
		tier.Tier.Type = tierType
		return tier
	}
	withSize := func(tier modelsDevTier, size int64) modelsDevTier {
		tier.Tier.Size = size
		return tier
	}
	withoutInput := func(tier modelsDevTier) modelsDevTier {
		tier.Input = nil
		return tier
	}
	withoutOutput := modelsDevTier{
		Input: floatPtr(20),
		Tier:  validTier.Tier,
	}

	tests := []struct {
		name  string
		tiers []modelsDevTier
	}{
		{"non-context tier", []modelsDevTier{withType(validTier, "requests")}},
		{"zero size", []modelsDevTier{withSize(validTier, 0)}},
		{"negative size", []modelsDevTier{withSize(validTier, -1)}},
		{"missing input", []modelsDevTier{withoutInput(validTier)}},
		{"duplicate sizes", []modelsDevTier{validTier, validTier}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			candidate, ok := buildModelsDevCandidate("openai", modelsDevCost{
				Input:  floatPtr(10),
				Output: floatPtr(50),
				Tiers:  tt.tiers,
			})
			require.True(t, ok, "invalid tiers must not reject the whole candidate")
			assert.Empty(t, candidate.Tiers)
		})
	}

	// A tier without output cannot produce a tiered expression but stays
	// available for flat pricing.
	candidate, ok := buildModelsDevCandidate("openai", modelsDevCost{
		Input:  floatPtr(10),
		Output: floatPtr(50),
		Tiers:  []modelsDevTier{withoutOutput},
	})
	require.True(t, ok)
	require.Len(t, candidate.Tiers, 1)
	assert.Nil(t, candidate.Tiers[0].Output)
}

func TestModelsDevBillingFieldsFlatWithCacheWrite(t *testing.T) {
	fields := modelsDevBillingFields(modelsDevCandidate{
		Provider:   "openai",
		Input:      10,
		Output:     floatPtr(50),
		CacheRead:  floatPtr(1),
		CacheWrite: floatPtr(12.5),
	})

	assert.Equal(t, 5.0, fields["model_ratio"])
	assert.Equal(t, 5.0, fields["completion_ratio"])
	assert.Equal(t, 0.1, fields["cache_ratio"])
	assert.Equal(t, 1.25, fields["create_cache_ratio"])
	assert.NotContains(t, fields, billing_setting.BillingModeField)
	assert.NotContains(t, fields, billing_setting.BillingExprField)
}

func TestModelsDevBillingFieldsFreeModel(t *testing.T) {
	fields := modelsDevBillingFields(modelsDevCandidate{
		Provider: "openai",
		Input:    0,
		Output:   floatPtr(0),
	})

	assert.Equal(t, 0.0, fields["model_ratio"])
	assert.Len(t, fields, 1)
}

func TestModelsDevBillingFieldsGeneratesTieredExpr(t *testing.T) {
	// gpt-6-astra on models.dev (openai provider)
	fields := modelsDevBillingFields(modelsDevCandidate{
		Provider:   "openai",
		Input:      10,
		Output:     floatPtr(50),
		CacheRead:  floatPtr(1),
		CacheWrite: floatPtr(12.5),
		Tiers: []modelsDevTierPrice{
			{
				Size:       272000,
				Input:      20,
				Output:     floatPtr(75),
				CacheRead:  floatPtr(2),
				CacheWrite: floatPtr(25),
			},
		},
	})

	assert.Equal(t, billing_setting.BillingModeTieredExpr, fields[billing_setting.BillingModeField])
	expr, ok := fields[billing_setting.BillingExprField].(string)
	require.True(t, ok)
	assert.Equal(t,
		`len <= 272000 ? tier("standard", p * 10 + c * 50 + cr * 1 + cc * 12.5) : tier("long_context", p * 20 + c * 75 + cr * 2 + cc * 25)`,
		expr)
	// Flat ratios stay as fallback/display values.
	assert.Equal(t, 5.0, fields["model_ratio"])
	assert.Equal(t, 1.25, fields["create_cache_ratio"])
}

func TestModelsDevBillingFieldsGeneratesMultiTierExpr(t *testing.T) {
	// doubao-seed-2-0-lite style: two context tiers
	fields := modelsDevBillingFields(modelsDevCandidate{
		Provider:  "volcengine",
		Input:     0.08,
		Output:    floatPtr(0.51),
		CacheRead: floatPtr(0.01692),
		Tiers: []modelsDevTierPrice{
			{Size: 128000, Input: 0.25, Output: floatPtr(1.52), CacheRead: floatPtr(0.05072)},
			{Size: 32000, Input: 0.13, Output: floatPtr(0.76), CacheRead: floatPtr(0.02536)},
		},
	})

	expr, ok := fields[billing_setting.BillingExprField].(string)
	require.True(t, ok, "expected tiered expr, fields: %v", fields)
	assert.Equal(t,
		`len <= 32000 ? tier("standard", p * 0.08 + c * 0.51 + cr * 0.01692) : len <= 128000 ? tier("tier_2", p * 0.13 + c * 0.76 + cr * 0.02536) : tier("long_context", p * 0.25 + c * 1.52 + cr * 0.05072)`,
		expr)
}

func TestModelsDevBillingFieldsSkipsTieredOnInconsistentCacheFields(t *testing.T) {
	// Base carries cache_write but the tier does not: generating an expr would
	// bill cache-write tokens at zero in the long-context tier.
	fields := modelsDevBillingFields(modelsDevCandidate{
		Provider:   "openai",
		Input:      10,
		Output:     floatPtr(50),
		CacheRead:  floatPtr(1),
		CacheWrite: floatPtr(12.5),
		Tiers: []modelsDevTierPrice{
			{Size: 272000, Input: 20, Output: floatPtr(75), CacheRead: floatPtr(2)},
		},
	})

	assert.NotContains(t, fields, billing_setting.BillingModeField)
	assert.NotContains(t, fields, billing_setting.BillingExprField)
	assert.Equal(t, 1.25, fields["create_cache_ratio"])
}

func TestModelsDevBillingFieldsSkipsTieredWhenIdentical(t *testing.T) {
	fields := modelsDevBillingFields(modelsDevCandidate{
		Provider:  "openai",
		Input:     10,
		Output:    floatPtr(50),
		CacheRead: floatPtr(1),
		Tiers: []modelsDevTierPrice{
			{Size: 272000, Input: 10, Output: floatPtr(50), CacheRead: floatPtr(1)},
		},
	})

	assert.NotContains(t, fields, billing_setting.BillingModeField)
	assert.NotContains(t, fields, billing_setting.BillingExprField)
}

func TestModelsDevTieredExprEvaluatesPerTier(t *testing.T) {
	fields := modelsDevBillingFields(modelsDevCandidate{
		Provider:   "openai",
		Input:      10,
		Output:     floatPtr(50),
		CacheRead:  floatPtr(1),
		CacheWrite: floatPtr(12.5),
		Tiers: []modelsDevTierPrice{
			{
				Size:       272000,
				Input:      20,
				Output:     floatPtr(75),
				CacheRead:  floatPtr(2),
				CacheWrite: floatPtr(25),
			},
		},
	})
	expr := fields[billing_setting.BillingExprField].(string)

	// Standard tier: 100k text input + 20k cache write + 5k output.
	cost, trace, err := billingexpr.RunExpr(expr, billingexpr.TokenParams{
		P: 100000, C: 5000, Len: 120000, CC: 20000,
	})
	require.NoError(t, err)
	assert.Equal(t, "standard", trace.MatchedTier)
	assert.InDelta(t, 100000*10+20000*12.5+5000*50, cost, 1e-6)

	// Long-context tier: 300k total context, 50k cache read + 100k cache write.
	cost, trace, err = billingexpr.RunExpr(expr, billingexpr.TokenParams{
		P: 150000, C: 10000, Len: 300000, CR: 50000, CC: 100000,
	})
	require.NoError(t, err)
	assert.Equal(t, "long_context", trace.MatchedTier)
	assert.InDelta(t, 150000*20+50000*2+100000*25+10000*75, cost, 1e-6)

	// Boundary: exactly 272000 belongs to the standard tier.
	_, trace, err = billingexpr.RunExpr(expr, billingexpr.TokenParams{
		P: 272000, C: 0, Len: 272000,
	})
	require.NoError(t, err)
	assert.Equal(t, "standard", trace.MatchedTier)
}

func TestConvertModelsDevToRatioDataIncludesCacheWriteAndTieredBilling(t *testing.T) {
	body := `{
		"openai": {"models": {
			"gpt-6-astra": {"cost": {
				"input": 10, "output": 50, "cache_read": 1, "cache_write": 12.5,
				"tiers": [{"input": 20, "output": 75, "cache_read": 2, "cache_write": 25, "tier": {"type": "context", "size": 272000}}]
			}},
			"gpt-4o-mini": {"cost": {"input": 0.15, "output": 0.6, "cache_read": 0.075}}
		}}
	}`

	converted, err := convertModelsDevToRatioData(strings.NewReader(body))
	require.NoError(t, err)

	createCache := valueMap(converted["create_cache_ratio"])
	require.NotNil(t, createCache)
	assert.Equal(t, 1.25, createCache["gpt-6-astra"])
	assert.NotContains(t, createCache, "gpt-4o-mini")

	billingModes := valueMap(converted[billing_setting.BillingModeField])
	require.NotNil(t, billingModes)
	assert.Equal(t, billing_setting.BillingModeTieredExpr, billingModes["gpt-6-astra"])
	assert.NotContains(t, billingModes, "gpt-4o-mini")

	billingExprs := valueMap(converted[billing_setting.BillingExprField])
	require.NotNil(t, billingExprs)
	expr, ok := billingExprs["gpt-6-astra"].(string)
	require.True(t, ok)
	assert.Contains(t, expr, `tier("standard", p * 10 + c * 50 + cr * 1 + cc * 12.5)`)
	assert.Contains(t, expr, `tier("long_context", p * 20 + c * 75 + cr * 2 + cc * 25)`)

	cacheRead := valueMap(converted["cache_ratio"])
	assert.Equal(t, 0.1, cacheRead["gpt-6-astra"])
	assert.Equal(t, 0.5, cacheRead["gpt-4o-mini"])
}

func TestConvertModelsDevToRatioDataPrefersRicherCandidateAtSamePrice(t *testing.T) {
	// Same input price from two providers: the one carrying tiers and cache
	// pricing must win, otherwise the sync silently drops usable fields.
	body := `{
		"302ai": {"models": {
			"gpt-6-astra": {"cost": {"input": 10, "output": 50}}
		}},
		"openai": {"models": {
			"gpt-6-astra": {"cost": {
				"input": 10, "output": 50, "cache_read": 1, "cache_write": 12.5,
				"tiers": [{"input": 20, "output": 75, "cache_read": 2, "cache_write": 25, "tier": {"type": "context", "size": 272000}}]
			}}
		}}
	}`

	converted, err := convertModelsDevToRatioData(strings.NewReader(body))
	require.NoError(t, err)

	createCache := valueMap(converted["create_cache_ratio"])
	assert.Equal(t, 1.25, createCache["gpt-6-astra"])

	billingExprs := valueMap(converted[billing_setting.BillingExprField])
	require.NotNil(t, billingExprs)
	assert.Contains(t, billingExprs["gpt-6-astra"], `tier("long_context"`)
}
