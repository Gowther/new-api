package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestGenerateDefaultSidebarConfigForRoleIncludesTokenUsage(t *testing.T) {
	configJSON := generateDefaultSidebarConfigForRole(common.RoleCommonUser)

	var config map[string]map[string]bool
	require.NoError(t, common.Unmarshal([]byte(configJSON), &config))
	require.True(t, config["console"]["token_usage"])
}
