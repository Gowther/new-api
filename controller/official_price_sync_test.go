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
