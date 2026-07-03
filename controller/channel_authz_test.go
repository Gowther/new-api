package controller

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChannelHasSensitiveChanges(t *testing.T) {
	baseURL := "https://api.example.com"
	headerOverride := `{"Authorization":"Bearer {api_key}"}`
	origin := &model.Channel{
		Type:           1,
		Key:            "old-key",
		BaseURL:        &baseURL,
		HeaderOverride: &headerOverride,
		Models:         "gpt-4o",
		Group:          "default",
	}

	t.Run("non-sensitive routing fields", func(t *testing.T) {
		updated := PatchChannel{Channel: *origin}
		updated.Models = "gpt-4o,gpt-4o-mini"
		updated.Group = "vip"

		assert.False(t, channelHasSensitiveChanges(&updated, origin, map[string]any{
			"models": updated.Models,
			"group":  updated.Group,
		}))
	})

	t.Run("key change", func(t *testing.T) {
		updated := PatchChannel{Channel: *origin}
		updated.Key = "new-key"

		assert.True(t, channelHasSensitiveChanges(&updated, origin, map[string]any{"key": updated.Key}))
	})

	t.Run("base url change", func(t *testing.T) {
		updated := PatchChannel{Channel: *origin}
		newBaseURL := "https://leak.example.com"
		updated.BaseURL = &newBaseURL

		assert.True(t, channelHasSensitiveChanges(&updated, origin, map[string]any{"base_url": newBaseURL}))
	})

	t.Run("header override change", func(t *testing.T) {
		updated := PatchChannel{Channel: *origin}
		newHeaderOverride := `{"X-Key":"{api_key}"}`
		updated.HeaderOverride = &newHeaderOverride

		assert.True(t, channelHasSensitiveChanges(&updated, origin, map[string]any{"header_override": newHeaderOverride}))
	})

	t.Run("omitted sensitive fields do not use zero values", func(t *testing.T) {
		updated := PatchChannel{}
		updated.Id = origin.Id
		updated.Priority = origin.Priority

		assert.False(t, channelHasSensitiveChanges(&updated, origin, map[string]any{"priority": 10}))
	})

	t.Run("unknown field fails closed", func(t *testing.T) {
		updated := PatchChannel{Channel: *origin}

		assert.True(t, channelHasSensitiveChanges(&updated, origin, map[string]any{"future_secret_field": "x"}))
	})

	t.Run("status is operational", func(t *testing.T) {
		updated := PatchChannel{Channel: *origin}
		updated.Status = common.ChannelStatusManuallyDisabled

		assert.False(t, channelHasSensitiveChanges(&updated, origin, map[string]any{"status": updated.Status}))
	})

	t.Run("read-only fields are ignored by sensitivity check", func(t *testing.T) {
		updated := PatchChannel{Channel: *origin}
		updated.Balance = 99
		updated.UsedQuota = 100
		updated.ResponseTime = 200

		assert.False(t, channelHasSensitiveChanges(&updated, origin, map[string]any{
			"balance":       updated.Balance,
			"used_quota":    updated.UsedQuota,
			"response_time": updated.ResponseTime,
		}))
	})
}

func TestClearChannelReadOnlyFields(t *testing.T) {
	channel := PatchChannel{Channel: model.Channel{
		CreatedTime:        11,
		TestTime:           22,
		ResponseTime:       33,
		Balance:            44.5,
		BalanceUpdatedTime: 55,
		UsedQuota:          66,
		Models:             "gpt-4o",
		Group:              "default",
	}}

	clearChannelReadOnlyFields(&channel, map[string]any{
		"created_time":         channel.CreatedTime,
		"test_time":            channel.TestTime,
		"response_time":        channel.ResponseTime,
		"balance":              channel.Balance,
		"balance_updated_time": channel.BalanceUpdatedTime,
		"used_quota":           channel.UsedQuota,
		"models":               channel.Models,
		"group":                channel.Group,
	})

	assert.Zero(t, channel.CreatedTime)
	assert.Zero(t, channel.TestTime)
	assert.Zero(t, channel.ResponseTime)
	assert.Zero(t, channel.Balance)
	assert.Zero(t, channel.BalanceUpdatedTime)
	assert.Zero(t, channel.UsedQuota)
	assert.Equal(t, "gpt-4o", channel.Models)
	assert.Equal(t, "default", channel.Group)
}

func TestUpdateChannelRejectsStatusField(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/channel/",
		bytes.NewBufferString(`{"id":1,"status":2}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")

	UpdateChannel(ctx)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	assert.False(t, response.Success)
}

func TestUpdateChannelAcceptsPriorityOnly(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	originalPriority := int64(1)
	newPriority := int64(9)
	weight := uint(3)
	autoBan := 1
	channel := model.Channel{
		Id:       1,
		Type:     1,
		Key:      "secret-key",
		Status:   common.ChannelStatusEnabled,
		Name:     "primary",
		Models:   "gpt-4o,gpt-4o-mini",
		Group:    "default",
		Priority: &originalPriority,
		Weight:   &weight,
		AutoBan:  &autoBan,
	}
	require.NoError(t, db.Create(&channel).Error)
	require.NoError(t, channel.UpdateAbilities(nil))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(
		http.MethodPut,
		"/api/channel/",
		bytes.NewBufferString(`{"id":1,"priority":9}`),
	)
	ctx.Request.Header.Set("Content-Type", "application/json")

	UpdateChannel(ctx)

	require.Equal(t, http.StatusOK, recorder.Code)
	var response struct {
		Success bool          `json:"success"`
		Message string        `json:"message"`
		Data    model.Channel `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success, response.Message)
	require.NotNil(t, response.Data.Priority)
	assert.Equal(t, newPriority, *response.Data.Priority)
	assert.Empty(t, response.Data.Key)

	updated, err := model.GetChannelById(1, true)
	require.NoError(t, err)
	require.NotNil(t, updated.Priority)
	assert.Equal(t, newPriority, *updated.Priority)
	assert.Equal(t, "secret-key", updated.Key)
	assert.Equal(t, "primary", updated.Name)
	assert.Equal(t, "gpt-4o,gpt-4o-mini", updated.Models)
	assert.Equal(t, "default", updated.Group)

	var abilities []model.Ability
	require.NoError(t, db.Where("channel_id = ?", 1).Find(&abilities).Error)
	require.Len(t, abilities, 2)
	for _, ability := range abilities {
		require.NotNil(t, ability.Priority)
		assert.Equal(t, newPriority, *ability.Priority)
	}
}

func TestChannelStatusValidation(t *testing.T) {
	assert.True(t, isManageableChannelStatus(common.ChannelStatusEnabled))
	assert.True(t, isManageableChannelStatus(common.ChannelStatusManuallyDisabled))
	assert.False(t, isManageableChannelStatus(common.ChannelStatusAutoDisabled))
	assert.False(t, isManageableChannelStatus(0))
}

func TestParseStatusFilter(t *testing.T) {
	cases := []struct {
		name     string
		input    string
		expected int
	}{
		{name: "empty", input: "", expected: channelStatusFilterAll},
		{name: "all", input: "all", expected: channelStatusFilterAll},
		{name: "enabled", input: "enabled", expected: common.ChannelStatusEnabled},
		{name: "enabled number", input: "1", expected: common.ChannelStatusEnabled},
		{name: "legacy disabled", input: "disabled", expected: channelStatusFilterDisabled},
		{name: "legacy disabled number", input: "0", expected: channelStatusFilterDisabled},
		{name: "unknown", input: "unknown", expected: common.ChannelStatusUnknown},
		{name: "manual disabled", input: "manual_disabled", expected: common.ChannelStatusManuallyDisabled},
		{name: "manual disabled number", input: "2", expected: common.ChannelStatusManuallyDisabled},
		{name: "auto disabled", input: "auto_disabled", expected: common.ChannelStatusAutoDisabled},
		{name: "auto disabled number", input: "3", expected: common.ChannelStatusAutoDisabled},
		{name: "invalid", input: "not-a-status", expected: channelStatusFilterAll},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.expected, parseStatusFilter(tc.input))
		})
	}
}

func TestChannelMatchesStatusFilter(t *testing.T) {
	assert.True(t, channelMatchesStatusFilter(common.ChannelStatusEnabled, channelStatusFilterAll))
	assert.True(t, channelMatchesStatusFilter(common.ChannelStatusManuallyDisabled, channelStatusFilterDisabled))
	assert.True(t, channelMatchesStatusFilter(common.ChannelStatusAutoDisabled, channelStatusFilterDisabled))
	assert.False(t, channelMatchesStatusFilter(common.ChannelStatusEnabled, channelStatusFilterDisabled))
	assert.True(t, channelMatchesStatusFilter(common.ChannelStatusAutoDisabled, common.ChannelStatusAutoDisabled))
	assert.False(t, channelMatchesStatusFilter(common.ChannelStatusManuallyDisabled, common.ChannelStatusAutoDisabled))
}

// TestChannelFieldsAreClassified guards the fail-closed sensitivity check: every
// JSON field of PatchChannel (including the embedded model.Channel) must be listed
// in channelSensitiveFields, channelNonSensitiveFields, or
// channelOperationalFields. A newly added field that is left unclassified will
// fail this test, forcing a conscious permission decision instead of silently
// defaulting either way.
func TestChannelFieldsAreClassified(t *testing.T) {
	classified := func(name string) bool {
		if _, ok := channelSensitiveFields[name]; ok {
			return true
		}
		if _, ok := channelNonSensitiveFields[name]; ok {
			return true
		}
		if _, ok := channelOperationalFields[name]; ok {
			return true
		}
		_, ok := channelReadOnlyFields[name]
		return ok
	}

	var collect func(rt reflect.Type) []string
	collect = func(rt reflect.Type) []string {
		var names []string
		for i := 0; i < rt.NumField(); i++ {
			field := rt.Field(i)
			if field.Anonymous && field.Type.Kind() == reflect.Struct {
				names = append(names, collect(field.Type)...)
				continue
			}
			name := strings.Split(field.Tag.Get("json"), ",")[0]
			if name == "" || name == "-" {
				continue
			}
			names = append(names, name)
		}
		return names
	}

	for _, name := range collect(reflect.TypeOf(PatchChannel{})) {
		assert.Truef(t, classified(name),
			"channel field %q is not classified; add it to channelSensitiveFields, channelNonSensitiveFields, channelOperationalFields, or channelReadOnlyFields in channel_authz.go", name)
	}
}
