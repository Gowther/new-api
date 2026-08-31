package model

import (
	"fmt"
	"sort"
	"strings"
)

// Fault clusters are keyed by model + group + channel + fingerprint, which is
// deliberately fine-grained: one revoked channel key shows up once per model it
// serves, and one upstream outage shows up once per group. Reading the list then
// means opening every row to notice they describe the same thing.
//
// Folding groups those clusters back into the problem an operator would act on.
// The scope is decided by what the failing clusters share, not by the error text,
// so this stays deterministic and needs no model call.
const (
	ErrorProblemScopeChannel = "channel"
	ErrorProblemScopeModel   = "model"
	ErrorProblemScopeCluster = "cluster"
)

// errorProblemFoldMinBreadth is how many distinct models (or channels) a status
// code must span before the clusters collapse into one channel-scoped (or
// model-scoped) problem. Two is enough to prove the fault is not specific to a
// single route, and keeps a lone failure reported as itself.
const errorProblemFoldMinBreadth = 2

type ErrorLogProblem struct {
	Key          string `json:"key"`
	Scope        string `json:"scope"`
	Severity     string `json:"severity"`
	Trend        string `json:"trend"`
	StatusCode   int    `json:"status_code"`
	ChannelId    int    `json:"channel"`
	ChannelName  string `json:"channel_name"`
	ModelName    string `json:"model_name"`
	ErrorSummary string `json:"error_summary"`
	// NormalizedErrorSummary is the fingerprint-normalized form of ErrorSummary,
	// with URLs, UUIDs, long tokens, and numbers already replaced by
	// placeholders. The AI briefing sends this rather than the raw text unless an
	// admin opts in, so upstream-controlled content leaks as little as possible.
	NormalizedErrorSummary string   `json:"normalized_error_summary"`
	ClusterKeys            []string `json:"cluster_keys"`
	ClusterCount           int      `json:"cluster_count"`
	Count                  int      `json:"count"`
	CurrentCount           int      `json:"current_count"`
	PreviousCount          int      `json:"previous_count"`
	AffectedRequests       int      `json:"affected_requests"`
	AffectedUsers          int      `json:"affected_users"`
	AffectedModels         []string `json:"affected_models"`
	AffectedChannels       []int    `json:"affected_channels"`
	FirstSeen              int64    `json:"first_seen"`
	LastSeen               int64    `json:"last_seen"`
}

// foldErrorLogProblems collapses ranked clusters into the problems behind them.
// Every cluster lands in exactly one problem, so the counts across problems add
// up to the visible list and nothing is reported twice.
//
// requestIdsByKey and userIdsByKey are the per-cluster identity sets built while
// scanning logs; unioning them keeps affected-request and affected-user counts
// honest when several clusters share the same request or user.
func foldErrorLogProblems(
	items []*ErrorLogSummaryItem,
	requestIdsByKey map[string]map[string]struct{},
	userIdsByKey map[string]map[int]struct{},
) []*ErrorLogProblem {
	if len(items) == 0 {
		return []*ErrorLogProblem{}
	}

	claimed := make(map[string]bool, len(items))
	problems := make([]*ErrorLogProblem, 0, len(items))

	// Channel scope first: one channel failing the same way across several
	// models is the broadest actionable unit, and the one an operator fixes at
	// the channel rather than per model.
	byChannel := make(map[string][]*ErrorLogSummaryItem)
	channelOrder := make([]string, 0, len(items))
	for _, item := range items {
		if item.ChannelId == 0 {
			continue
		}
		key := fmt.Sprintf("%d\x1f%d\x1f%s", item.ChannelId, item.StatusCode, errorProblemSignature(item))
		if _, seen := byChannel[key]; !seen {
			channelOrder = append(channelOrder, key)
		}
		byChannel[key] = append(byChannel[key], item)
	}
	for _, key := range channelOrder {
		group := byChannel[key]
		if countDistinctModels(group) < errorProblemFoldMinBreadth {
			continue
		}
		problems = append(problems, buildErrorLogProblem(ErrorProblemScopeChannel, group, requestIdsByKey, userIdsByKey))
		for _, item := range group {
			claimed[item.Key] = true
		}
	}

	// Model scope next: one model failing the same way across several channels
	// points at the model rather than any single upstream.
	byModel := make(map[string][]*ErrorLogSummaryItem)
	modelOrder := make([]string, 0, len(items))
	for _, item := range items {
		if claimed[item.Key] || item.ModelName == "" {
			continue
		}
		key := fmt.Sprintf("%s\x1f%d\x1f%s", item.ModelName, item.StatusCode, errorProblemSignature(item))
		if _, seen := byModel[key]; !seen {
			modelOrder = append(modelOrder, key)
		}
		byModel[key] = append(byModel[key], item)
	}
	for _, key := range modelOrder {
		group := byModel[key]
		if countDistinctChannels(group) < errorProblemFoldMinBreadth {
			continue
		}
		problems = append(problems, buildErrorLogProblem(ErrorProblemScopeModel, group, requestIdsByKey, userIdsByKey))
		for _, item := range group {
			claimed[item.Key] = true
		}
	}

	// Whatever is left is already as narrow as one model on one channel. The
	// summary key also contains the group, so collapse otherwise-identical group
	// variants here instead of showing the same route fault several times.
	byRoute := make(map[string][]*ErrorLogSummaryItem)
	routeOrder := make([]string, 0, len(items))
	for _, item := range items {
		if claimed[item.Key] {
			continue
		}
		key := fmt.Sprintf("%s\x1f%d\x1f%d\x1f%s", item.ModelName, item.ChannelId, item.StatusCode, errorProblemSignature(item))
		if _, seen := byRoute[key]; !seen {
			routeOrder = append(routeOrder, key)
		}
		byRoute[key] = append(byRoute[key], item)
	}
	for _, key := range routeOrder {
		problems = append(problems, buildErrorLogProblem(
			ErrorProblemScopeCluster,
			byRoute[key],
			requestIdsByKey,
			userIdsByKey,
		))
	}

	sort.SliceStable(problems, func(i, j int) bool {
		leftSeverity := errorSummarySeverityRank(problems[i].Severity)
		rightSeverity := errorSummarySeverityRank(problems[j].Severity)
		if leftSeverity != rightSeverity {
			return leftSeverity > rightSeverity
		}
		if problems[i].AffectedRequests != problems[j].AffectedRequests {
			return problems[i].AffectedRequests > problems[j].AffectedRequests
		}
		if problems[i].Count != problems[j].Count {
			return problems[i].Count > problems[j].Count
		}
		if problems[i].LastSeen != problems[j].LastSeen {
			return problems[i].LastSeen > problems[j].LastSeen
		}
		return problems[i].Key < problems[j].Key
	})
	return problems
}

func buildErrorLogProblem(
	scope string,
	group []*ErrorLogSummaryItem,
	requestIdsByKey map[string]map[string]struct{},
	userIdsByKey map[string]map[int]struct{},
) *ErrorLogProblem {
	problem := &ErrorLogProblem{
		Scope:        scope,
		StatusCode:   group[0].StatusCode,
		ClusterKeys:  make([]string, 0, len(group)),
		ClusterCount: len(group),
		Severity:     "low",
	}

	models := make(map[string]struct{}, len(group))
	channels := make(map[int]struct{}, len(group))
	requestIds := make(map[string]struct{})
	userIds := make(map[int]struct{})
	// A folded problem inherits the worst severity and the longest error text
	// among its clusters: the operator needs the most urgent framing, and the
	// fullest message is the most useful one to read.
	longestSummary := ""

	for _, item := range group {
		problem.ClusterKeys = append(problem.ClusterKeys, item.Key)
		problem.Count += item.Count
		problem.CurrentCount += item.CurrentCount
		problem.PreviousCount += item.PreviousCount

		if item.ModelName != "" {
			models[item.ModelName] = struct{}{}
		}
		if item.ChannelId != 0 {
			channels[item.ChannelId] = struct{}{}
		}
		for requestId := range requestIdsByKey[item.Key] {
			requestIds[requestId] = struct{}{}
		}
		for userId := range userIdsByKey[item.Key] {
			userIds[userId] = struct{}{}
		}

		if errorSummarySeverityRank(item.Severity) > errorSummarySeverityRank(problem.Severity) {
			problem.Severity = item.Severity
		}
		if len(item.ErrorSummary) > len(longestSummary) {
			longestSummary = item.ErrorSummary
		}
		if problem.FirstSeen == 0 || item.FirstSeen < problem.FirstSeen {
			problem.FirstSeen = item.FirstSeen
		}
		if item.LastSeen > problem.LastSeen {
			problem.LastSeen = item.LastSeen
		}
	}

	problem.ErrorSummary = longestSummary
	problem.NormalizedErrorSummary = normalizeErrorFingerprintText(longestSummary)
	problem.AffectedRequests = len(requestIds)
	problem.AffectedUsers = len(userIds)
	problem.Trend = classifyErrorSummaryTrend(problem.CurrentCount, problem.PreviousCount)

	problem.AffectedModels = make([]string, 0, len(models))
	for name := range models {
		problem.AffectedModels = append(problem.AffectedModels, name)
	}
	sort.Strings(problem.AffectedModels)

	problem.AffectedChannels = make([]int, 0, len(channels))
	for id := range channels {
		problem.AffectedChannels = append(problem.AffectedChannels, id)
	}
	sort.Ints(problem.AffectedChannels)

	// Identify the problem by whatever its scope makes constant across clusters,
	// and leave the other side blank so the UI does not imply a single culprit.
	switch scope {
	case ErrorProblemScopeChannel:
		problem.ChannelId = group[0].ChannelId
		problem.ChannelName = group[0].ChannelName
		problem.Key = fmt.Sprintf("%s\x1f%d\x1f%d\x1f%s", scope, problem.ChannelId, problem.StatusCode, errorProblemSignature(group[0]))
	case ErrorProblemScopeModel:
		problem.ModelName = group[0].ModelName
		problem.Key = fmt.Sprintf("%s\x1f%s\x1f%d\x1f%s", scope, problem.ModelName, problem.StatusCode, errorProblemSignature(group[0]))
	default:
		problem.ChannelId = group[0].ChannelId
		problem.ChannelName = group[0].ChannelName
		problem.ModelName = group[0].ModelName
		problem.Key = fmt.Sprintf("%s\x1f%s\x1f%d\x1f%d\x1f%s", scope, problem.ModelName, problem.ChannelId, problem.StatusCode, errorProblemSignature(group[0]))
	}
	return problem
}

func errorProblemSignature(item *ErrorLogSummaryItem) string {
	if item.Fingerprint != "" {
		return item.Fingerprint
	}
	return buildErrorFingerprint(item.ErrorType, item.ErrorCode, item.StatusCode, item.ErrorSummary)
}

func countDistinctModels(items []*ErrorLogSummaryItem) int {
	names := make(map[string]struct{}, len(items))
	for _, item := range items {
		if item.ModelName != "" {
			names[item.ModelName] = struct{}{}
		}
	}
	return len(names)
}

func countDistinctChannels(items []*ErrorLogSummaryItem) int {
	ids := make(map[int]struct{}, len(items))
	for _, item := range items {
		if item.ChannelId != 0 {
			ids[item.ChannelId] = struct{}{}
		}
	}
	return len(ids)
}

// DescribeErrorLogProblem renders one problem as a single line of prompt input
// for the AI briefing. It carries the folded scope and the metrics that decide
// urgency, so the model ranks and merges from the same facts the UI shows.
func DescribeErrorLogProblem(problem *ErrorLogProblem, errorText string) string {
	var b strings.Builder
	switch problem.Scope {
	case ErrorProblemScopeChannel:
		fmt.Fprintf(&b, "channel #%d (%s)", problem.ChannelId, problem.ChannelName)
	case ErrorProblemScopeModel:
		fmt.Fprintf(&b, "model %s", problem.ModelName)
	default:
		fmt.Fprintf(&b, "model %s on channel #%d (%s)", problem.ModelName, problem.ChannelId, problem.ChannelName)
	}
	fmt.Fprintf(&b, " | status=%d | severity=%s | trend=%s", problem.StatusCode, problem.Severity, problem.Trend)
	fmt.Fprintf(&b, " | errors=%d | requests=%d | users=%d", problem.Count, problem.AffectedRequests, problem.AffectedUsers)
	if len(problem.AffectedModels) > 1 {
		fmt.Fprintf(&b, " | models=%d", len(problem.AffectedModels))
	}
	if len(problem.AffectedChannels) > 1 {
		fmt.Fprintf(&b, " | channels=%d", len(problem.AffectedChannels))
	}
	if errorText != "" {
		fmt.Fprintf(&b, " | error=%q", errorText)
	}
	return b.String()
}
