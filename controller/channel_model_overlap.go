package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

type ChannelModelOverlapRequest struct {
	Channel  *model.Channel   `json:"channel"`
	Channels []*model.Channel `json:"channels"`
}

type ChannelModelOverlapUpstream struct {
	Type               int    `json:"type"`
	BaseURL            string `json:"base_url"`
	OpenAIOrganization string `json:"openai_organization"`
	KeyFingerprint     string `json:"key_fingerprint"`
}

type ChannelModelOverlapChannel struct {
	Id       int    `json:"id"`
	Name     string `json:"name"`
	Group    string `json:"group"`
	Priority *int64 `json:"priority"`
	Status   int    `json:"status"`
}

type ChannelModelOverlapItem struct {
	Upstream ChannelModelOverlapUpstream  `json:"upstream"`
	Model    string                       `json:"model"`
	Channels []ChannelModelOverlapChannel `json:"channels"`
}

type channelModelOverlapSourceKey struct {
	Type               int
	BaseURL            string
	OpenAIOrganization string
	KeyFingerprint     string
}

type channelModelOverlapGroupKey struct {
	Source channelModelOverlapSourceKey
	Model  string
}

type channelModelOverlapGroup struct {
	upstream ChannelModelOverlapUpstream
	model    string
	channels []ChannelModelOverlapChannel
}

type channelModelOverlapSourceInfo struct {
	key      channelModelOverlapSourceKey
	upstream ChannelModelOverlapUpstream
}

func channelModelOverlapFingerprint(key string) (string, string) {
	normalized := strings.TrimSpace(key)
	if normalized == "" {
		return "", ""
	}
	sum := sha256.Sum256([]byte(normalized))
	full := hex.EncodeToString(sum[:])
	return full, full[:12]
}

func channelModelOverlapSourceForKey(channel *model.Channel, keyValue string) (channelModelOverlapSourceKey, ChannelModelOverlapUpstream) {
	baseURL := ""
	if channel.BaseURL != nil {
		baseURL = strings.TrimRight(strings.TrimSpace(*channel.BaseURL), "/")
	}
	openAIOrganization := ""
	if channel.OpenAIOrganization != nil {
		openAIOrganization = strings.TrimSpace(*channel.OpenAIOrganization)
	}
	fullFingerprint, displayFingerprint := channelModelOverlapFingerprint(keyValue)
	key := channelModelOverlapSourceKey{
		Type:               channel.Type,
		BaseURL:            baseURL,
		OpenAIOrganization: openAIOrganization,
		KeyFingerprint:     fullFingerprint,
	}
	upstream := ChannelModelOverlapUpstream{
		Type:               channel.Type,
		BaseURL:            baseURL,
		OpenAIOrganization: openAIOrganization,
		KeyFingerprint:     displayFingerprint,
	}
	return key, upstream
}

func channelModelOverlapKeys(channel *model.Channel) []string {
	if !channel.ChannelInfo.IsMultiKey {
		return []string{channel.Key}
	}
	keys := make([]string, 0)
	seen := make(map[string]struct{})
	for _, key := range strings.Split(strings.Trim(channel.Key, "\n"), "\n") {
		trimmed := strings.TrimSpace(key)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		keys = append(keys, trimmed)
	}
	if len(keys) == 0 {
		return []string{channel.Key}
	}
	return keys
}

func channelModelOverlapSources(channel *model.Channel) []channelModelOverlapSourceInfo {
	keys := channelModelOverlapKeys(channel)
	sources := make([]channelModelOverlapSourceInfo, 0, len(keys))
	for _, keyValue := range keys {
		sourceKey, upstream := channelModelOverlapSourceForKey(channel, keyValue)
		sources = append(sources, channelModelOverlapSourceInfo{
			key:      sourceKey,
			upstream: upstream,
		})
	}
	return sources
}

func channelModelOverlapChannel(channel *model.Channel) ChannelModelOverlapChannel {
	return ChannelModelOverlapChannel{
		Id:       channel.Id,
		Name:     channel.Name,
		Group:    channel.Group,
		Priority: channel.Priority,
		Status:   channel.Status,
	}
}

func buildChannelModelOverlapGroups(channels []*model.Channel) map[channelModelOverlapGroupKey]*channelModelOverlapGroup {
	groups := make(map[channelModelOverlapGroupKey]*channelModelOverlapGroup)
	for _, channel := range channels {
		if channel == nil {
			continue
		}
		for _, source := range channelModelOverlapSources(channel) {
			for _, modelName := range normalizeModelNames(channel.GetModels()) {
				groupKey := channelModelOverlapGroupKey{Source: source.key, Model: modelName}
				group, ok := groups[groupKey]
				if !ok {
					group = &channelModelOverlapGroup{
						upstream: source.upstream,
						model:    modelName,
						channels: make([]ChannelModelOverlapChannel, 0, 2),
					}
					groups[groupKey] = group
				}
				group.channels = append(group.channels, channelModelOverlapChannel(channel))
			}
		}
	}
	return groups
}

func resolveChannelModelOverlapCandidate(channel *model.Channel) (*model.Channel, error) {
	if channel == nil || channel.Id <= 0 {
		return channel, nil
	}
	originChannel, err := model.GetChannelById(channel.Id, true)
	if err != nil {
		return nil, err
	}
	resolved := *originChannel
	if channel.Type != 0 || originChannel.Type == 0 {
		resolved.Type = channel.Type
	}
	if channel.Key != "" {
		resolved.Key = channel.Key
	}
	if channel.BaseURL != nil {
		resolved.BaseURL = channel.BaseURL
	}
	if channel.OpenAIOrganization != nil {
		resolved.OpenAIOrganization = channel.OpenAIOrganization
	}
	if channel.Models != "" {
		resolved.Models = channel.Models
	}
	if channel.Name != "" {
		resolved.Name = channel.Name
	}
	if channel.Group != "" {
		resolved.Group = channel.Group
	}
	if channel.Priority != nil {
		resolved.Priority = channel.Priority
	}
	if channel.Status != 0 {
		resolved.Status = channel.Status
	}
	return &resolved, nil
}

func detectChannelModelOverlaps(channels []*model.Channel, candidate *model.Channel) []ChannelModelOverlapItem {
	groups := buildChannelModelOverlapGroups(channels)
	items := make([]ChannelModelOverlapItem, 0)

	if candidate != nil {
		items = collectCandidateChannelModelOverlaps(groups, []*model.Channel{candidate})
	} else {
		for _, group := range groups {
			if len(group.channels) < 2 {
				continue
			}
			items = append(items, ChannelModelOverlapItem{
				Upstream: group.upstream,
				Model:    group.model,
				Channels: group.channels,
			})
		}
	}

	sortChannelModelOverlapItems(items)
	return items
}

func collectCandidateChannelModelOverlaps(groups map[channelModelOverlapGroupKey]*channelModelOverlapGroup, candidates []*model.Channel) []ChannelModelOverlapItem {
	itemsByKey := make(map[channelModelOverlapGroupKey]ChannelModelOverlapItem)
	for _, candidate := range candidates {
		if candidate == nil {
			continue
		}
		for _, source := range channelModelOverlapSources(candidate) {
			for _, modelName := range normalizeModelNames(candidate.GetModels()) {
				groupKey := channelModelOverlapGroupKey{Source: source.key, Model: modelName}
				group := groups[groupKey]
				if group == nil {
					continue
				}
				channels := make([]ChannelModelOverlapChannel, 0, len(group.channels))
				for _, channel := range group.channels {
					if candidate.Id > 0 && channel.Id == candidate.Id {
						continue
					}
					channels = append(channels, channel)
				}
				if len(channels) == 0 {
					continue
				}
				if existing, ok := itemsByKey[groupKey]; ok {
					seen := make(map[int]struct{}, len(existing.Channels)+len(channels))
					for _, channel := range existing.Channels {
						seen[channel.Id] = struct{}{}
					}
					for _, channel := range channels {
						if _, ok := seen[channel.Id]; ok {
							continue
						}
						existing.Channels = append(existing.Channels, channel)
					}
					itemsByKey[groupKey] = existing
					continue
				}
				itemsByKey[groupKey] = ChannelModelOverlapItem{
					Upstream: source.upstream,
					Model:    modelName,
					Channels: channels,
				}
			}
		}
	}

	items := make([]ChannelModelOverlapItem, 0, len(itemsByKey))
	for _, item := range itemsByKey {
		items = append(items, item)
	}
	sortChannelModelOverlapItems(items)
	return items
}

func sortChannelModelOverlapItems(items []ChannelModelOverlapItem) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].Upstream.Type != items[j].Upstream.Type {
			return items[i].Upstream.Type < items[j].Upstream.Type
		}
		if items[i].Upstream.BaseURL != items[j].Upstream.BaseURL {
			return items[i].Upstream.BaseURL < items[j].Upstream.BaseURL
		}
		if items[i].Model != items[j].Model {
			return items[i].Model < items[j].Model
		}
		return items[i].Upstream.KeyFingerprint < items[j].Upstream.KeyFingerprint
	})
}

func CheckChannelModelOverlap(c *gin.Context) {
	req := ChannelModelOverlapRequest{}
	rawBody, err := c.GetRawData()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if strings.TrimSpace(string(rawBody)) != "" {
		if err := common.Unmarshal(rawBody, &req); err != nil {
			common.ApiError(c, err)
			return
		}
	}

	channels := make([]*model.Channel, 0)
	if err := model.DB.Find(&channels).Error; err != nil {
		common.ApiError(c, err)
		return
	}

	candidates := make([]*model.Channel, 0, len(req.Channels)+1)
	if req.Channel != nil {
		candidates = append(candidates, req.Channel)
	}
	candidates = append(candidates, req.Channels...)
	if len(candidates) == 0 {
		common.ApiSuccess(c, gin.H{
			"items": detectChannelModelOverlaps(channels, nil),
		})
		return
	}
	for i, candidate := range candidates {
		resolved, err := resolveChannelModelOverlapCandidate(candidate)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		candidates[i] = resolved
	}

	common.ApiSuccess(c, gin.H{
		"items": collectCandidateChannelModelOverlaps(buildChannelModelOverlapGroups(channels), candidates),
	})
}
