package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

func TestDetectChannelModelOverlaps_GlobalGroupsSameSourceModel(t *testing.T) {
	baseURLWithSlash := "https://api.example.com/"
	baseURL := "https://api.example.com"
	openAIOrganization := "org-a"
	priorityHigh := int64(10)
	priorityLow := int64(5)

	items := detectChannelModelOverlaps([]*model.Channel{
		{
			Id:                 12,
			Type:               constant.ChannelTypeOpenAI,
			Key:                "sk-same",
			BaseURL:            &baseURLWithSlash,
			OpenAIOrganization: &openAIOrganization,
			Name:               "公益A - DeepSeek",
			Group:              "default",
			Priority:           &priorityHigh,
			Status:             common.ChannelStatusEnabled,
			Models:             "deepseek-chat,gpt-4o",
		},
		{
			Id:                 18,
			Type:               constant.ChannelTypeOpenAI,
			Key:                " sk-same ",
			BaseURL:            &baseURL,
			OpenAIOrganization: &openAIOrganization,
			Name:               "公益A - GLM",
			Group:              "default",
			Priority:           &priorityLow,
			Status:             common.ChannelStatusEnabled,
			Models:             "deepseek-chat,glm-4",
		},
		{
			Id:                 20,
			Type:               constant.ChannelTypeOpenAI,
			Key:                "sk-other",
			BaseURL:            &baseURL,
			OpenAIOrganization: &openAIOrganization,
			Name:               "different key",
			Status:             common.ChannelStatusEnabled,
			Models:             "deepseek-chat",
		},
		{
			Id:                 21,
			Type:               constant.ChannelTypeDeepSeek,
			Key:                "sk-same",
			BaseURL:            &baseURL,
			OpenAIOrganization: &openAIOrganization,
			Name:               "different type",
			Status:             common.ChannelStatusEnabled,
			Models:             "deepseek-chat",
		},
	}, nil)

	require.Len(t, items, 1)
	require.Equal(t, "deepseek-chat", items[0].Model)
	require.Equal(t, constant.ChannelTypeOpenAI, items[0].Upstream.Type)
	require.Equal(t, baseURL, items[0].Upstream.BaseURL)
	require.Equal(t, openAIOrganization, items[0].Upstream.OpenAIOrganization)
	require.Len(t, items[0].Upstream.KeyFingerprint, 12)
	require.NotContains(t, items[0].Upstream.KeyFingerprint, "sk-same")
	require.Equal(t, []ChannelModelOverlapChannel{
		{
			Id:       12,
			Name:     "公益A - DeepSeek",
			Group:    "default",
			Priority: &priorityHigh,
			Status:   common.ChannelStatusEnabled,
		},
		{
			Id:       18,
			Name:     "公益A - GLM",
			Group:    "default",
			Priority: &priorityLow,
			Status:   common.ChannelStatusEnabled,
		},
	}, items[0].Channels)
}

func TestDetectChannelModelOverlaps_CandidateExcludesItself(t *testing.T) {
	baseURL := "https://api.example.com"
	existing := []*model.Channel{
		{
			Id:      12,
			Type:    constant.ChannelTypeOpenAI,
			Key:     "sk-same",
			BaseURL: &baseURL,
			Name:    "current channel",
			Status:  common.ChannelStatusEnabled,
			Models:  "deepseek-chat",
		},
		{
			Id:      18,
			Type:    constant.ChannelTypeOpenAI,
			Key:     "sk-same",
			BaseURL: &baseURL,
			Name:    "peer channel",
			Status:  common.ChannelStatusEnabled,
			Models:  "deepseek-chat",
		},
	}
	candidate := &model.Channel{
		Id:      12,
		Type:    constant.ChannelTypeOpenAI,
		Key:     "sk-same",
		BaseURL: &baseURL,
		Models:  "deepseek-chat,gpt-4o",
	}

	items := detectChannelModelOverlaps(existing, candidate)

	require.Len(t, items, 1)
	require.Equal(t, "deepseek-chat", items[0].Model)
	require.Equal(t, []ChannelModelOverlapChannel{
		{
			Id:     18,
			Name:   "peer channel",
			Status: common.ChannelStatusEnabled,
		},
	}, items[0].Channels)
}

func TestDetectChannelModelOverlaps_SplitsMultiKeyChannels(t *testing.T) {
	baseURL := "https://api.example.com"
	items := detectChannelModelOverlaps([]*model.Channel{
		{
			Id:      12,
			Type:    constant.ChannelTypeOpenAI,
			Key:     "sk-a\nsk-b",
			BaseURL: &baseURL,
			Name:    "multi-key channel",
			Status:  common.ChannelStatusEnabled,
			Models:  "deepseek-chat",
			ChannelInfo: model.ChannelInfo{
				IsMultiKey: true,
			},
		},
		{
			Id:      18,
			Type:    constant.ChannelTypeOpenAI,
			Key:     "sk-b",
			BaseURL: &baseURL,
			Name:    "single-key peer",
			Status:  common.ChannelStatusEnabled,
			Models:  "deepseek-chat",
		},
	}, nil)

	require.Len(t, items, 1)
	require.Equal(t, "deepseek-chat", items[0].Model)
	require.Equal(t, []ChannelModelOverlapChannel{
		{
			Id:     12,
			Name:   "multi-key channel",
			Status: common.ChannelStatusEnabled,
		},
		{
			Id:     18,
			Name:   "single-key peer",
			Status: common.ChannelStatusEnabled,
		},
	}, items[0].Channels)
}

func TestDetectChannelModelOverlaps_CandidateRequiresSameSource(t *testing.T) {
	baseURL := "https://api.example.com"
	orgA := "org-a"
	orgB := "org-b"
	existing := []*model.Channel{
		{
			Id:                 12,
			Type:               constant.ChannelTypeOpenAI,
			Key:                "sk-same",
			BaseURL:            &baseURL,
			OpenAIOrganization: &orgA,
			Name:               "org a",
			Status:             common.ChannelStatusEnabled,
			Models:             "deepseek-chat",
		},
	}
	candidate := &model.Channel{
		Type:               constant.ChannelTypeOpenAI,
		Key:                "sk-same",
		BaseURL:            &baseURL,
		OpenAIOrganization: &orgB,
		Models:             "deepseek-chat",
	}

	items := detectChannelModelOverlaps(existing, candidate)

	require.Empty(t, items)
}
