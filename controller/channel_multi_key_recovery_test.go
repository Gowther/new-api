package controller

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestManageMultiKeysRestoresOnlyAutomaticKeyExhaustion(t *testing.T) {
	for _, cacheEnabled := range []bool{false, true} {
		for _, action := range []string{"enable_key", "enable_all_keys"} {
			for _, tc := range []struct {
				name, reason string
				status, want int
			}{
				{"exhausted", "All keys are disabled", common.ChannelStatusAutoDisabled, common.ChannelStatusEnabled},
				{"manually disabled after exhaustion", "All keys are disabled", common.ChannelStatusManuallyDisabled, common.ChannelStatusManuallyDisabled},
				{"manual disable", "manual operation", common.ChannelStatusManuallyDisabled, common.ChannelStatusManuallyDisabled},
				{"other automatic disable", "latency threshold exceeded", common.ChannelStatusAutoDisabled, common.ChannelStatusAutoDisabled},
			} {
				t.Run(fmt.Sprintf("cache=%t/%s/%s", cacheEnabled, action, tc.name), func(t *testing.T) {
					db := setupModelListControllerTestDB(t)
					previousCache := common.MemoryCacheEnabled
					common.MemoryCacheEnabled = cacheEnabled
					t.Cleanup(func() { common.MemoryCacheEnabled = previousCache })
					channel := model.Channel{
						Name: "multi-key recovery", Key: "key-one\nkey-two", Status: tc.status, Models: "test-model", Group: "default",
						ChannelInfo: model.ChannelInfo{
							IsMultiKey: true, MultiKeySize: 2,
							MultiKeyStatusList:     map[int]int{0: common.ChannelStatusAutoDisabled, 1: common.ChannelStatusAutoDisabled},
							MultiKeyDisabledReason: map[int]string{0: "provider failure", 1: "provider failure"},
							MultiKeyDisabledTime:   map[int]int64{0: 100, 1: 100},
						},
					}
					channel.SetOtherInfo(map[string]any{"status_reason": tc.reason})
					require.NoError(t, channel.Insert())
					model.InitChannelCache()
					body, err := common.Marshal(MultiKeyManageRequest{ChannelId: channel.Id, Action: action, KeyIndex: common.GetPointer(0)})
					require.NoError(t, err)
					recorder := httptest.NewRecorder()
					ctx, _ := gin.CreateTestContext(recorder)
					ctx.Set("id", 1)
					ctx.Set("role", common.RoleRootUser)
					ctx.Request = httptest.NewRequest(http.MethodPost, "/api/channel/multi_key/manage", bytes.NewReader(body))
					ctx.Request.Header.Set("Content-Type", "application/json")
					ManageMultiKeys(ctx)
					require.Equal(t, http.StatusOK, recorder.Code)
					var response struct {
						Success bool `json:"success"`
					}
					require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
					require.True(t, response.Success, recorder.Body.String())
					stored, err := model.GetChannelById(channel.Id, true)
					require.NoError(t, err)
					assert.Equal(t, tc.want, stored.Status)
					assert.NotContains(t, stored.ChannelInfo.MultiKeyStatusList, 0)
					assert.NotContains(t, stored.ChannelInfo.MultiKeyDisabledReason, 0)
					assert.NotContains(t, stored.ChannelInfo.MultiKeyDisabledTime, 0)
					if tc.want == common.ChannelStatusEnabled {
						assert.Empty(t, stored.GetOtherInfo()["status_reason"])
					} else {
						assert.Equal(t, tc.reason, stored.GetOtherInfo()["status_reason"])
					}
					var abilities []model.Ability
					require.NoError(t, db.Where("channel_id = ?", channel.Id).Find(&abilities).Error)
					require.NotEmpty(t, abilities)
					assert.Equal(t, tc.want == common.ChannelStatusEnabled, abilities[0].Enabled)
					if cacheEnabled {
						cached, err := model.CacheGetChannel(channel.Id)
						require.NoError(t, err)
						assert.Equal(t, tc.want, cached.Status)
					}
				})
			}
		}
	}
}
