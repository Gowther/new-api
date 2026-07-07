package controller

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGroupModelNamesByVendorUsesModelRules(t *testing.T) {
	db := setupModelListControllerTestDB(t)

	openai := model.Vendor{Name: "OpenAI", Status: 1}
	anthropic := model.Vendor{Name: "Anthropic", Status: 1}
	require.NoError(t, db.Create(&openai).Error)
	require.NoError(t, db.Create(&anthropic).Error)
	require.NoError(t, db.Create(&model.Model{
		ModelName: "gpt-4o",
		VendorID:  openai.Id,
		Status:    1,
		NameRule:  model.NameRuleExact,
	}).Error)
	require.NoError(t, db.Create(&model.Model{
		ModelName: "claude-",
		VendorID:  anthropic.Id,
		Status:    1,
		NameRule:  model.NameRulePrefix,
	}).Error)

	groups, err := model.GroupModelNamesByVendor([]string{
		"gpt-4o",
		"claude-3-opus",
		"unknown-model",
	})

	require.NoError(t, err)
	require.Len(t, groups, 3)
	assert.Equal(t, openai.Id, groups[0].VendorID)
	assert.Equal(t, "OpenAI", groups[0].VendorName)
	assert.Equal(t, []string{"gpt-4o"}, groups[0].Models)
	assert.Equal(t, anthropic.Id, groups[1].VendorID)
	assert.Equal(t, "Anthropic", groups[1].VendorName)
	assert.Equal(t, []string{"claude-3-opus"}, groups[1].Models)
	assert.Equal(t, 0, groups[2].VendorID)
	assert.Equal(t, []string{"unknown-model"}, groups[2].Models)
}

func TestBuildModelVendorSplitChannelsFiltersMappingAndKeepsMultiKey(t *testing.T) {
	db := setupModelListControllerTestDB(t)

	openai := model.Vendor{Name: "OpenAI", Status: 1}
	anthropic := model.Vendor{Name: "Anthropic", Status: 1}
	require.NoError(t, db.Create(&openai).Error)
	require.NoError(t, db.Create(&anthropic).Error)
	require.NoError(t, db.Create(&model.Model{
		ModelName: "gpt-4o",
		VendorID:  openai.Id,
		Status:    1,
		NameRule:  model.NameRuleExact,
	}).Error)
	require.NoError(t, db.Create(&model.Model{
		ModelName: "claude-",
		VendorID:  anthropic.Id,
		Status:    1,
		NameRule:  model.NameRulePrefix,
	}).Error)

	modelMapping := `{"gpt-4o":"gpt-4o-2024-08-06","claude-3-opus":"claude-3-opus-20240229"}`
	testModel := "gpt-4o"
	channel := model.Channel{
		Name:         "primary",
		Type:         constant.ChannelTypeOpenAI,
		Key:          "key-a\nkey-b",
		Models:       "gpt-4o,claude-3-opus",
		ModelMapping: &modelMapping,
		TestModel:    &testModel,
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: 2,
		},
	}

	channels, err := buildModelVendorSplitChannels(channel, nil)

	require.NoError(t, err)
	require.Len(t, channels, 2)
	assert.Equal(t, "primary - OpenAI", channels[0].Name)
	assert.Equal(t, "gpt-4o", channels[0].Models)
	assert.Equal(t, "key-a\nkey-b", channels[0].Key)
	assert.True(t, channels[0].ChannelInfo.IsMultiKey)
	require.NotNil(t, channels[0].TestModel)
	assert.Equal(t, "gpt-4o", *channels[0].TestModel)

	var openaiMapping map[string]string
	require.NotNil(t, channels[0].ModelMapping)
	require.NoError(t, common.Unmarshal([]byte(*channels[0].ModelMapping), &openaiMapping))
	assert.Equal(t, map[string]string{
		"gpt-4o": "gpt-4o-2024-08-06",
	}, openaiMapping)

	assert.Equal(t, "primary - Anthropic", channels[1].Name)
	assert.Equal(t, "claude-3-opus", channels[1].Models)
	assert.Equal(t, "key-a\nkey-b", channels[1].Key)
	assert.True(t, channels[1].ChannelInfo.IsMultiKey)
	assert.Nil(t, channels[1].TestModel)

	var anthropicMapping map[string]string
	require.NotNil(t, channels[1].ModelMapping)
	require.NoError(t, common.Unmarshal([]byte(*channels[1].ModelMapping), &anthropicMapping))
	assert.Equal(t, map[string]string{
		"claude-3-opus": "claude-3-opus-20240229",
	}, anthropicMapping)
}

func TestBuildModelVendorSplitChannelsAddsVendorNameForSingleGroup(t *testing.T) {
	db := setupModelListControllerTestDB(t)

	openai := model.Vendor{Name: "OpenAI", Status: 1}
	require.NoError(t, db.Create(&openai).Error)
	require.NoError(t, db.Create(&model.Model{
		ModelName: "gpt-4o",
		VendorID:  openai.Id,
		Status:    1,
		NameRule:  model.NameRuleExact,
	}).Error)

	channels, err := buildModelVendorSplitChannels(model.Channel{
		Name:   "primary",
		Type:   constant.ChannelTypeOpenAI,
		Key:    "key-a",
		Models: "gpt-4o",
	}, nil)

	require.NoError(t, err)
	require.Len(t, channels, 1)
	assert.Equal(t, "primary - OpenAI", channels[0].Name)
	assert.Equal(t, "gpt-4o", channels[0].Models)
}

func TestBuildModelVendorSplitChannelsFiltersSelectedVendors(t *testing.T) {
	db := setupModelListControllerTestDB(t)

	openai := model.Vendor{Name: "OpenAI", Status: 1}
	anthropic := model.Vendor{Name: "Anthropic", Status: 1}
	require.NoError(t, db.Create(&openai).Error)
	require.NoError(t, db.Create(&anthropic).Error)
	require.NoError(t, db.Create(&model.Model{
		ModelName: "gpt-4o",
		VendorID:  openai.Id,
		Status:    1,
		NameRule:  model.NameRuleExact,
	}).Error)
	require.NoError(t, db.Create(&model.Model{
		ModelName: "claude-",
		VendorID:  anthropic.Id,
		Status:    1,
		NameRule:  model.NameRulePrefix,
	}).Error)

	channels, err := buildModelVendorSplitChannels(model.Channel{
		Name:   "primary",
		Type:   constant.ChannelTypeOpenAI,
		Key:    "key-a",
		Models: "gpt-4o,claude-3-opus",
	}, []int{anthropic.Id})

	require.NoError(t, err)
	require.Len(t, channels, 1)
	assert.Equal(t, "primary - Anthropic", channels[0].Name)
	assert.Equal(t, "claude-3-opus", channels[0].Models)
}

func TestBuildModelVendorSplitChannelsRejectsEmptySelectedVendors(t *testing.T) {
	channels, err := buildModelVendorSplitChannels(model.Channel{
		Name:   "primary",
		Type:   constant.ChannelTypeOpenAI,
		Key:    "key-a",
		Models: "gpt-4o",
	}, []int{})

	require.ErrorContains(t, err, "请至少选择一个模型供应商")
	assert.Nil(t, channels)
}

func TestFormatModelVendorSplitChannelNameKeepsExistingVendorSuffix(t *testing.T) {
	tests := []struct {
		name       string
		vendorName string
		want       string
	}{
		{name: "primary-OpenAI", vendorName: "OpenAI", want: "primary-OpenAI"},
		{name: "primary - OpenAI", vendorName: "OpenAI", want: "primary - OpenAI"},
		{name: "primary  -  OpenAI", vendorName: "OpenAI", want: "primary  -  OpenAI"},
		{name: "primary", vendorName: "OpenAI", want: "primary - OpenAI"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, formatModelVendorSplitChannelName(tt.name, tt.vendorName))
		})
	}
}
