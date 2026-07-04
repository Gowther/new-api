package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func requireTextChannelTestPrompt(t *testing.T, input []byte) {
	t.Helper()

	var messages []dto.Message
	require.NoError(t, common.Unmarshal(input, &messages))
	require.Len(t, messages, 1)
	require.Equal(t, "user", messages[0].Role)
	require.Equal(t, channelTestTextPrompt, messages[0].Content)
}

func TestBuildTestRequestUsesDescriptiveTextPrompt(t *testing.T) {
	t.Run("chat completions", func(t *testing.T) {
		request := buildTestRequest("gpt-4o", "", nil, false)
		chatRequest, ok := request.(*dto.GeneralOpenAIRequest)
		require.True(t, ok)
		require.Len(t, chatRequest.Messages, 1)
		require.Equal(t, "user", chatRequest.Messages[0].Role)
		require.Equal(t, channelTestTextPrompt, chatRequest.Messages[0].Content)
	})

	t.Run("responses", func(t *testing.T) {
		request := buildTestRequest("gpt-4o", string(constant.EndpointTypeOpenAIResponse), nil, false)
		responsesRequest, ok := request.(*dto.OpenAIResponsesRequest)
		require.True(t, ok)
		requireTextChannelTestPrompt(t, responsesRequest.Input)
	})

	t.Run("responses compact", func(t *testing.T) {
		request := buildTestRequest("gpt-4o", string(constant.EndpointTypeOpenAIResponseCompact), nil, false)
		compactRequest, ok := request.(*dto.OpenAIResponsesCompactionRequest)
		require.True(t, ok)
		requireTextChannelTestPrompt(t, compactRequest.Input)
	})
}

func TestSettleTestQuotaUsesTieredBilling(t *testing.T) {
	info := &relaycommon.RelayInfo{
		TieredBillingSnapshot: &billingexpr.BillingSnapshot{
			BillingMode:   "tiered_expr",
			ExprString:    `param("stream") == true ? tier("stream", p * 3) : tier("base", p * 2)`,
			ExprHash:      billingexpr.ExprHashString(`param("stream") == true ? tier("stream", p * 3) : tier("base", p * 2)`),
			GroupRatio:    1,
			EstimatedTier: "stream",
			QuotaPerUnit:  common.QuotaPerUnit,
			ExprVersion:   1,
		},
		BillingRequestInput: &billingexpr.RequestInput{
			Body: []byte(`{"stream":true}`),
		},
	}

	quota, result := settleTestQuota(info, types.PriceData{
		ModelRatio:      1,
		CompletionRatio: 2,
	}, &dto.Usage{
		PromptTokens: 1000,
	})

	require.Equal(t, 1500, quota)
	require.NotNil(t, result)
	require.Equal(t, "stream", result.MatchedTier)
}

func TestBuildTestLogOtherInjectsTieredInfo(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())

	info := &relaycommon.RelayInfo{
		TieredBillingSnapshot: &billingexpr.BillingSnapshot{
			BillingMode: "tiered_expr",
			ExprString:  `tier("base", p * 2)`,
		},
		ChannelMeta: &relaycommon.ChannelMeta{},
	}
	priceData := types.PriceData{
		GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1},
	}
	usage := &dto.Usage{
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens: 12,
		},
	}

	other := buildTestLogOther(ctx, info, priceData, usage, &billingexpr.TieredResult{
		MatchedTier: "base",
	})

	require.Equal(t, "tiered_expr", other["billing_mode"])
	require.Equal(t, "base", other["matched_tier"])
	require.NotEmpty(t, other["expr_b64"])
}

func TestResolveChannelTestUserIDUsesRequestUser(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set("id", 2)

	userID, err := resolveChannelTestUserID(ctx)

	require.NoError(t, err)
	require.Equal(t, 2, userID)
}

func TestSelectChannelsForAutomaticTestPassiveRecoveryOnlyUsesAutoDisabled(t *testing.T) {
	channels := []*model.Channel{
		{Id: 1, Status: common.ChannelStatusEnabled},
		{Id: 2, Status: common.ChannelStatusAutoDisabled},
		{Id: 3, Status: common.ChannelStatusManuallyDisabled},
	}

	selected, skipped := selectChannelsForAutomaticTest(channels, operation_setting.ChannelTestModePassiveRecovery, 1000, false)

	require.Len(t, selected, 1)
	require.Equal(t, 2, selected[0].Id)
	require.Zero(t, skipped)
}

func TestSelectChannelsForAutomaticTestPassiveRecoveryIncludesAutoDisabledMultiKey(t *testing.T) {
	channels := []*model.Channel{
		{
			Id:     1,
			Status: common.ChannelStatusEnabled,
			ChannelInfo: model.ChannelInfo{
				IsMultiKey: true,
				MultiKeyStatusList: map[int]int{
					1: common.ChannelStatusAutoDisabled,
				},
			},
		},
		{
			Id:     2,
			Status: common.ChannelStatusEnabled,
			ChannelInfo: model.ChannelInfo{
				IsMultiKey: true,
				MultiKeyStatusList: map[int]int{
					1: common.ChannelStatusManuallyDisabled,
				},
			},
		},
		{Id: 3, Status: common.ChannelStatusAutoDisabled},
		{
			Id:     4,
			Status: common.ChannelStatusManuallyDisabled,
			ChannelInfo: model.ChannelInfo{
				IsMultiKey: true,
				MultiKeyStatusList: map[int]int{
					1: common.ChannelStatusAutoDisabled,
				},
			},
		},
	}

	selected, skipped := selectChannelsForAutomaticTest(channels, operation_setting.ChannelTestModePassiveRecovery, 1000, false)

	require.Len(t, selected, 2)
	require.Equal(t, 1, selected[0].Id)
	require.Equal(t, 3, selected[1].Id)
	require.Zero(t, skipped)
}

func TestSelectChannelsForAutomaticTestScheduledSkipsManualDisabled(t *testing.T) {
	channels := []*model.Channel{
		{Id: 1, Status: common.ChannelStatusEnabled},
		{Id: 2, Status: common.ChannelStatusAutoDisabled},
		{Id: 3, Status: common.ChannelStatusManuallyDisabled},
	}

	selected, skipped := selectChannelsForAutomaticTest(channels, operation_setting.ChannelTestModeScheduledAll, 1000, false)

	require.Len(t, selected, 2)
	require.Equal(t, 1, selected[0].Id)
	require.Equal(t, 2, selected[1].Id)
	require.Zero(t, skipped)
}

func TestAutoDisabledMultiKeyIndexesReturnsOnlyValidAutoDisabledKeys(t *testing.T) {
	channel := &model.Channel{
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: 3,
			MultiKeyStatusList: map[int]int{
				0: common.ChannelStatusManuallyDisabled,
				1: common.ChannelStatusAutoDisabled,
				2: common.ChannelStatusAutoDisabled,
				4: common.ChannelStatusAutoDisabled,
			},
		},
	}

	require.Equal(t, []int{1, 2}, autoDisabledMultiKeyIndexes(channel))
}

func TestSelectChannelsForAutomaticTestAppliesPerChannelPolicy(t *testing.T) {
	now := int64(1000)
	channels := []*model.Channel{
		{Id: 1, Status: common.ChannelStatusAutoDisabled, TestTime: now - 120, OtherSettings: `{"auto_test_channel_interval_minutes":1}`},
		{Id: 2, Status: common.ChannelStatusAutoDisabled, TestTime: now - 30, OtherSettings: `{"auto_test_channel_interval_minutes":1}`},
		{Id: 3, Status: common.ChannelStatusAutoDisabled, OtherSettings: `{"automatic_channel_test_disabled":true}`},
		{Id: 4, Status: common.ChannelStatusAutoDisabled, TestTime: 0},
	}

	selected, skipped := selectChannelsForAutomaticTest(channels, operation_setting.ChannelTestModePassiveRecovery, now, true)

	require.Len(t, selected, 2)
	require.Equal(t, 1, selected[0].Id)
	require.Equal(t, 4, selected[1].Id)
	require.Equal(t, 2, skipped)
}

func TestSelectChannelsForAutomaticTestManualBypassesPerChannelPolicy(t *testing.T) {
	now := int64(1000)
	channels := []*model.Channel{
		{Id: 1, Status: common.ChannelStatusEnabled, TestTime: now - 30, OtherSettings: `{"auto_test_channel_interval_minutes":60}`},
		{Id: 2, Status: common.ChannelStatusAutoDisabled, OtherSettings: `{"automatic_channel_test_disabled":true}`},
		{Id: 3, Status: common.ChannelStatusManuallyDisabled},
	}

	selected, skipped := selectChannelsForAutomaticTest(channels, operation_setting.ChannelTestModeScheduledAll, now, false)

	require.Len(t, selected, 2)
	require.Equal(t, 1, selected[0].Id)
	require.Equal(t, 2, selected[1].Id)
	require.Zero(t, skipped)
}

func TestUpdateChannelStatusByKeyIndexRecoversExactMultiKeyIndex(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
	})

	channel := model.Channel{
		Type:   constant.ChannelTypeOpenAI,
		Key:    "duplicate-key\nduplicate-key\nmanual-key",
		Name:   "multi-key",
		Status: common.ChannelStatusEnabled,
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: 3,
			MultiKeyStatusList: map[int]int{
				0: common.ChannelStatusAutoDisabled,
				1: common.ChannelStatusAutoDisabled,
				2: common.ChannelStatusManuallyDisabled,
			},
			MultiKeyDisabledReason: map[int]string{
				0: "auto disabled first duplicate",
				1: "auto disabled second duplicate",
				2: "manual disabled",
			},
			MultiKeyDisabledTime: map[int]int64{
				0: 10,
				1: 20,
				2: 30,
			},
		},
	}
	require.NoError(t, db.Create(&channel).Error)

	require.True(t, model.UpdateChannelStatusByKeyIndex(channel.Id, 1, common.ChannelStatusEnabled, ""))

	var saved model.Channel
	require.NoError(t, db.First(&saved, channel.Id).Error)
	require.Equal(t, common.ChannelStatusEnabled, saved.Status)
	require.Equal(t, common.ChannelStatusAutoDisabled, saved.ChannelInfo.MultiKeyStatusList[0])
	require.NotContains(t, saved.ChannelInfo.MultiKeyStatusList, 1)
	require.Equal(t, common.ChannelStatusManuallyDisabled, saved.ChannelInfo.MultiKeyStatusList[2])
	require.NotContains(t, saved.ChannelInfo.MultiKeyDisabledReason, 1)
	require.NotContains(t, saved.ChannelInfo.MultiKeyDisabledTime, 1)
}

func TestUpdateChannelStatusByKeyIndexEnablesAllDisabledMultiKeyChannel(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = false
	t.Cleanup(func() {
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
	})

	channel := model.Channel{
		Type:   constant.ChannelTypeOpenAI,
		Key:    "first-key\nsecond-key",
		Name:   "all-disabled-multi-key",
		Status: common.ChannelStatusAutoDisabled,
		ChannelInfo: model.ChannelInfo{
			IsMultiKey:   true,
			MultiKeySize: 2,
			MultiKeyStatusList: map[int]int{
				0: common.ChannelStatusAutoDisabled,
				1: common.ChannelStatusAutoDisabled,
			},
		},
	}
	require.NoError(t, db.Create(&channel).Error)

	require.True(t, model.UpdateChannelStatusByKeyIndex(channel.Id, 1, common.ChannelStatusEnabled, ""))

	var saved model.Channel
	require.NoError(t, db.First(&saved, channel.Id).Error)
	require.Equal(t, common.ChannelStatusEnabled, saved.Status)
	require.Equal(t, common.ChannelStatusAutoDisabled, saved.ChannelInfo.MultiKeyStatusList[0])
	require.NotContains(t, saved.ChannelInfo.MultiKeyStatusList, 1)
}

func TestTestAllChannelsRejectsExistingActiveTask(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.SystemTask{}, &model.SystemTaskLock{}))

	existing, err := model.CreateSystemTask(model.SystemTaskTypeChannelTest, nil, nil)
	require.NoError(t, err)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/api/channel/test", nil)

	TestAllChannels(ctx)

	require.Equal(t, http.StatusConflict, recorder.Code)
	require.Contains(t, recorder.Body.String(), existing.TaskID)
	require.Contains(t, recorder.Body.String(), "已有通道测试任务正在运行或等待中")
}
