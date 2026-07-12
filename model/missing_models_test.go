package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestDeleteStalePricingKeysRemovesWhitespaceVariants(t *testing.T) {
	values := map[string]any{
		" stale-model ": 1.0,
		"active-model":  2.0,
	}
	staleModels := map[string]struct{}{
		"stale-model": {},
	}

	changed := deleteStalePricingKeys(values, staleModels)

	require.True(t, changed)
	require.Equal(t, map[string]any{"active-model": 2.0}, values)
}
