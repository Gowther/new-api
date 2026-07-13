package controller

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

type ChannelModelVendorGroupsRequest struct {
	Models []string `json:"models"`
}

func PreviewChannelModelVendorGroups(c *gin.Context) {
	req := ChannelModelVendorGroupsRequest{}
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiError(c, err)
		return
	}

	groups, err := model.GroupModelNamesByVendor(req.Models)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, groups)
}

func buildModelVendorSplitChannels(channel model.Channel, selectedVendorIDs []int) ([]model.Channel, error) {
	if selectedVendorIDs != nil && len(selectedVendorIDs) == 0 {
		return nil, fmt.Errorf("请至少选择一个模型供应商")
	}

	groups, err := model.GroupModelNamesByVendor(channel.GetModels())
	if err != nil {
		return nil, err
	}
	if len(groups) == 0 {
		return nil, fmt.Errorf("未能按供应商分组模型")
	}

	channels := make([]model.Channel, 0, len(groups))
	selectedVendorIDSet := make(map[int]struct{}, len(selectedVendorIDs))
	for _, vendorID := range selectedVendorIDs {
		selectedVendorIDSet[vendorID] = struct{}{}
	}
	for _, group := range groups {
		if selectedVendorIDs != nil {
			if _, ok := selectedVendorIDSet[group.VendorID]; !ok {
				continue
			}
		}
		if len(group.Models) == 0 {
			continue
		}
		localChannel := channel
		switch strings.ToLower(strings.TrimSpace(group.VendorName)) {
		case "anthropic":
			localChannel.Type = constant.ChannelTypeAnthropic
		case "openai":
			localChannel.Type = constant.ChannelTypeOpenAI
		}
		localChannel.Models = strings.Join(group.Models, ",")
		localChannel.Name = formatModelVendorSplitChannelName(channel.Name, group.VendorName)
		localChannel.ModelMapping, err = filterModelMappingByModels(channel.ModelMapping, group.Models)
		if err != nil {
			return nil, fmt.Errorf("模型映射拆分失败: %w", err)
		}
		if localChannel.TestModel != nil && !containsModelName(group.Models, *localChannel.TestModel) {
			localChannel.TestModel = nil
		}
		channels = append(channels, localChannel)
	}
	if len(channels) == 0 {
		return nil, fmt.Errorf("未能按供应商分组模型")
	}
	return channels, nil
}

func formatModelVendorSplitChannelName(name string, vendorName string) string {
	name = strings.TrimSpace(name)
	vendorName = strings.TrimSpace(vendorName)
	if vendorName == "" {
		vendorName = "未匹配供应商"
	}
	if name == "" {
		return vendorName
	}
	if hasModelVendorSplitChannelNameSuffix(name, vendorName) {
		return name
	}
	return fmt.Sprintf("%s - %s", name, vendorName)
}

func hasModelVendorSplitChannelNameSuffix(name string, vendorName string) bool {
	normalizedName := normalizeModelVendorSplitChannelName(name)
	normalizedVendor := normalizeModelVendorSplitChannelName(vendorName)
	if normalizedName == "" || normalizedVendor == "" {
		return false
	}
	return normalizedName == normalizedVendor || strings.HasSuffix(normalizedName, "-"+normalizedVendor)
}

func normalizeModelVendorSplitChannelName(name string) string {
	parts := strings.Split(strings.TrimSpace(name), "-")
	for i, part := range parts {
		parts[i] = strings.Join(strings.Fields(part), " ")
	}
	return strings.Join(parts, "-")
}

func filterModelMappingByModels(mapping *string, models []string) (*string, error) {
	if mapping == nil || strings.TrimSpace(*mapping) == "" {
		return mapping, nil
	}

	var parsed map[string]string
	if err := common.Unmarshal([]byte(*mapping), &parsed); err != nil {
		return nil, err
	}

	modelSet := make(map[string]struct{}, len(models))
	for _, modelName := range models {
		modelName = strings.TrimSpace(modelName)
		if modelName != "" {
			modelSet[modelName] = struct{}{}
		}
	}

	filtered := make(map[string]string)
	for source, target := range parsed {
		source = strings.TrimSpace(source)
		if _, ok := modelSet[source]; ok {
			filtered[source] = target
		}
	}
	if len(filtered) == 0 {
		return nil, nil
	}

	bytes, err := common.Marshal(filtered)
	if err != nil {
		return nil, err
	}
	value := string(bytes)
	return &value, nil
}

func containsModelName(models []string, modelName string) bool {
	modelName = strings.TrimSpace(modelName)
	for _, item := range models {
		if strings.TrimSpace(item) == modelName {
			return true
		}
	}
	return false
}
