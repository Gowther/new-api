package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFoldErrorLogProblemsCollapsesOneChannelAcrossModels(t *testing.T) {
	items := []*ErrorLogSummaryItem{
		{Key: "a", Fingerprint: "same-auth-fault", ModelName: "gpt-4o", ChannelId: 12, ChannelName: "azure-east", StatusCode: 401, Severity: "high", Count: 5, CurrentCount: 5, ErrorSummary: "invalid api key", FirstSeen: 100, LastSeen: 400},
		{Key: "b", Fingerprint: "same-auth-fault", ModelName: "gpt-4o-mini", ChannelId: 12, ChannelName: "azure-east", StatusCode: 401, Severity: "critical", Count: 3, CurrentCount: 3, ErrorSummary: "invalid api key provided", FirstSeen: 200, LastSeen: 300},
	}
	requestIds := map[string]map[string]struct{}{
		"a": {"r1": {}, "r2": {}},
		"b": {"r2": {}, "r3": {}},
	}
	userIds := map[string]map[int]struct{}{
		"a": {7: {}},
		"b": {7: {}, 8: {}},
	}

	problems := foldErrorLogProblems(items, requestIds, userIds)

	require.Len(t, problems, 1)
	problem := problems[0]
	assert.Equal(t, ErrorProblemScopeChannel, problem.Scope)
	assert.Equal(t, 12, problem.ChannelId)
	assert.Equal(t, "azure-east", problem.ChannelName)
	assert.Equal(t, 401, problem.StatusCode)
	assert.Equal(t, 2, problem.ClusterCount)
	assert.Equal(t, 8, problem.Count)
	// A channel-scoped problem names no single model, since every model it
	// serves is failing the same way.
	assert.Empty(t, problem.ModelName)
	assert.Equal(t, []string{"gpt-4o", "gpt-4o-mini"}, problem.AffectedModels)
	// Shared requests and users are counted once, not summed per cluster.
	assert.Equal(t, 3, problem.AffectedRequests)
	assert.Equal(t, 2, problem.AffectedUsers)
	// The worst severity and widest time window win.
	assert.Equal(t, "critical", problem.Severity)
	assert.Equal(t, int64(100), problem.FirstSeen)
	assert.Equal(t, int64(400), problem.LastSeen)
	assert.Equal(t, "invalid api key provided", problem.ErrorSummary)
}

func TestFoldErrorLogProblemsCollapsesOneModelAcrossChannels(t *testing.T) {
	items := []*ErrorLogSummaryItem{
		{Key: "a", Fingerprint: "same-rate-limit", ModelName: "gpt-4o", ChannelId: 21, ChannelName: "up-a", StatusCode: 429, Severity: "high", Count: 4, CurrentCount: 4, LastSeen: 500},
		{Key: "b", Fingerprint: "same-rate-limit", ModelName: "gpt-4o", ChannelId: 22, ChannelName: "up-b", StatusCode: 429, Severity: "medium", Count: 2, CurrentCount: 2, LastSeen: 400},
	}

	problems := foldErrorLogProblems(items, nil, nil)

	require.Len(t, problems, 1)
	problem := problems[0]
	assert.Equal(t, ErrorProblemScopeModel, problem.Scope)
	assert.Equal(t, "gpt-4o", problem.ModelName)
	assert.Equal(t, []int{21, 22}, problem.AffectedChannels)
	// A model-scoped problem names no single channel.
	assert.Zero(t, problem.ChannelId)
	assert.Equal(t, 6, problem.Count)
}

func TestFoldErrorLogProblemsKeepsNarrowClustersAndPartitionsEveryCluster(t *testing.T) {
	items := []*ErrorLogSummaryItem{
		// Folds by channel: same channel, same status, two models.
		{Key: "c1", Fingerprint: "same-channel-fault", ModelName: "gpt-4o", ChannelId: 12, StatusCode: 401, Severity: "high", Count: 2, CurrentCount: 2},
		{Key: "c2", Fingerprint: "same-channel-fault", ModelName: "gpt-4o-mini", ChannelId: 12, StatusCode: 401, Severity: "high", Count: 2, CurrentCount: 2},
		// Folds by model: same model, same status, two channels.
		{Key: "m1", Fingerprint: "same-model-fault", ModelName: "claude-sonnet", ChannelId: 31, StatusCode: 429, Severity: "medium", Count: 1, CurrentCount: 1},
		{Key: "m2", Fingerprint: "same-model-fault", ModelName: "claude-sonnet", ChannelId: 32, StatusCode: 429, Severity: "medium", Count: 1, CurrentCount: 1},
		// Folds with nothing: alone on its channel and its model.
		{Key: "s1", ModelName: "gemini-flash", ChannelId: 41, StatusCode: 400, Severity: "low", Count: 1, CurrentCount: 1},
	}

	problems := foldErrorLogProblems(items, nil, nil)

	require.Len(t, problems, 3)
	scopes := map[string]string{}
	folded := 0
	for _, problem := range problems {
		for _, key := range problem.ClusterKeys {
			_, duplicate := scopes[key]
			require.False(t, duplicate, "cluster %s landed in more than one problem", key)
			scopes[key] = problem.Scope
		}
		folded += problem.ClusterCount
	}
	// Every cluster is represented exactly once: the problem list is a complete
	// partition of the visible clusters, so per-problem counts stay comparable
	// with the list totals.
	assert.Equal(t, len(items), folded)
	assert.Equal(t, ErrorProblemScopeChannel, scopes["c1"])
	assert.Equal(t, ErrorProblemScopeChannel, scopes["c2"])
	assert.Equal(t, ErrorProblemScopeModel, scopes["m1"])
	assert.Equal(t, ErrorProblemScopeModel, scopes["m2"])
	assert.Equal(t, ErrorProblemScopeCluster, scopes["s1"])
}

func TestFoldErrorLogProblemsSeparatesDifferentStatusCodesOnSameChannel(t *testing.T) {
	items := []*ErrorLogSummaryItem{
		{Key: "a", Fingerprint: "same-auth-fault", ModelName: "gpt-4o", ChannelId: 12, StatusCode: 401, Severity: "high", Count: 3, CurrentCount: 3},
		{Key: "b", Fingerprint: "same-auth-fault", ModelName: "gpt-4o-mini", ChannelId: 12, StatusCode: 401, Severity: "high", Count: 3, CurrentCount: 3},
		{Key: "c", ModelName: "gpt-4o", ChannelId: 12, StatusCode: 500, Severity: "high", Count: 9, CurrentCount: 9},
	}

	problems := foldErrorLogProblems(items, nil, nil)

	// A revoked key and an upstream 5xx on the same channel are different
	// problems with different fixes, so they must not merge.
	require.Len(t, problems, 2)
	assert.Equal(t, 500, problems[0].StatusCode)
	assert.Equal(t, ErrorProblemScopeCluster, problems[0].Scope)
	assert.Equal(t, 401, problems[1].StatusCode)
	assert.Equal(t, ErrorProblemScopeChannel, problems[1].Scope)
}

func TestFoldErrorLogProblemsSeparatesDifferentFingerprintsWithSameStatus(t *testing.T) {
	items := []*ErrorLogSummaryItem{
		{Key: "a", Fingerprint: "invalid-key", ModelName: "gpt-4o", ChannelId: 12, StatusCode: 401, Severity: "high", Count: 3, CurrentCount: 3},
		{Key: "b", Fingerprint: "expired-token", ModelName: "gpt-4o-mini", ChannelId: 12, StatusCode: 401, Severity: "high", Count: 2, CurrentCount: 2},
	}

	problems := foldErrorLogProblems(items, nil, nil)

	require.Len(t, problems, 2)
	assert.NotEqual(t, problems[0].Key, problems[1].Key)
	assert.Equal(t, ErrorProblemScopeCluster, problems[0].Scope)
	assert.Equal(t, ErrorProblemScopeCluster, problems[1].Scope)
}

func TestFoldErrorLogProblemsCollapsesOtherwiseIdenticalGroupVariants(t *testing.T) {
	items := []*ErrorLogSummaryItem{
		{Key: "default", Fingerprint: "same-upstream-fault", ModelName: "gpt-4o", Group: "default", ChannelId: 12, StatusCode: 502, Severity: "high", Count: 3, CurrentCount: 3},
		{Key: "vip", Fingerprint: "same-upstream-fault", ModelName: "gpt-4o", Group: "vip", ChannelId: 12, StatusCode: 502, Severity: "high", Count: 2, CurrentCount: 2},
	}

	problems := foldErrorLogProblems(items, nil, nil)

	require.Len(t, problems, 1)
	assert.Equal(t, ErrorProblemScopeCluster, problems[0].Scope)
	assert.Equal(t, 2, problems[0].ClusterCount)
	assert.Equal(t, 5, problems[0].Count)
	assert.ElementsMatch(t, []string{"default", "vip"}, problems[0].ClusterKeys)

	reversed := foldErrorLogProblems([]*ErrorLogSummaryItem{items[1], items[0]}, nil, nil)
	require.Len(t, reversed, 1)
	assert.Equal(t, problems[0].Key, reversed[0].Key)
}

func TestFoldErrorLogProblemsRanksBySeverityThenReach(t *testing.T) {
	items := []*ErrorLogSummaryItem{
		{Key: "noisy", ModelName: "a", ChannelId: 1, StatusCode: 400, Severity: "low", Count: 100, CurrentCount: 100},
		{Key: "urgent", ModelName: "b", ChannelId: 2, StatusCode: 401, Severity: "critical", Count: 2, CurrentCount: 2},
	}
	requestIds := map[string]map[string]struct{}{
		"noisy":  {"r1": {}},
		"urgent": {"r2": {}},
	}

	problems := foldErrorLogProblems(items, requestIds, nil)

	require.Len(t, problems, 2)
	// Severity outranks raw volume: a high-count client-side 400 must not bury
	// a critical auth failure at the top of the briefing.
	assert.Equal(t, "critical", problems[0].Severity)
	assert.Equal(t, "low", problems[1].Severity)
}

func TestFoldErrorLogProblemsReturnsEmptyForNoClusters(t *testing.T) {
	problems := foldErrorLogProblems(nil, nil, nil)
	assert.Empty(t, problems)
}
