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
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

func TestMergeOfficialPriceLocalModelNamesIncludesEnabledChannelModels(t *testing.T) {
	modelNames := mergeOfficialPriceLocalModelNames(
		map[string]any{
			"model_price": map[string]any{
				"priced-model": 0.01,
			},
		},
		map[string]model.Pricing{
			"pricing-model": {
				ModelName: "pricing-model",
			},
		},
		[]string{"channel-only-model", "priced-model", " "},
		[]string{"metadata-model", "channel-only-model", ""},
	)

	require.Equal(t, []string{
		"channel-only-model",
		"metadata-model",
		"priced-model",
		"pricing-model",
	}, modelNames)
}

func TestPreviewOfficialPriceSourceNamesDefaultsToAllSources(t *testing.T) {
	require.Equal(t, []string{
		officialPriceSourceModelsDev,
		officialPriceSourceBaseLLM,
	}, previewOfficialPriceSourceNames(""))
	require.Equal(t, []string{
		officialPriceSourceModelsDev,
		officialPriceSourceBaseLLM,
	}, previewOfficialPriceSourceNamesFromSlice(nil))
}

func TestOfficialPriceSourceNamesFiltersUnsupportedSources(t *testing.T) {
	require.Equal(t, []string{
		officialPriceSourceModelsDev,
		officialPriceSourceBaseLLM,
	}, officialPriceSourceNames([]string{
		officialPriceSourceBaseLLM + "," + officialPriceSourceModelsDev,
		"unsupported-source",
		officialPriceSourceBaseLLM,
	}))
}

func TestOfficialPriceMappingSourceNamesUsesSavedMappingSources(t *testing.T) {
	require.Equal(t, []string{officialPriceSourceBaseLLM}, officialPriceMappingSourceNames(
		map[string]dto.OfficialPriceMapping{
			"saved-model": {
				Source: officialPriceSourceBaseLLM,
			},
			"unknown-source-model": {
				Source: "unsupported-source",
			},
		},
	))
}

func TestFilterOfficialPriceLocalModelsUsesRequestedExistingModels(t *testing.T) {
	require.Equal(t, []string{
		"gpt-4.1",
		"gpt-5",
	}, filterOfficialPriceLocalModels(
		[]string{"gpt-4.1", "gpt-5", "qwen-max"},
		[]string{"gpt-5", " ", "missing-model", "gpt-4.1", "gpt-5"},
	))
}
