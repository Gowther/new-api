package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetStatusDoesNotExposePasskeyOrigins(t *testing.T) {
	settings := system_setting.GetPasskeySettings()
	originalSettings := *settings
	originalOptionMap := common.OptionMap
	originalServerAddress := system_setting.ServerAddress
	t.Cleanup(func() {
		*settings = originalSettings
		common.OptionMap = originalOptionMap
		system_setting.ServerAddress = originalServerAddress
	})
	common.OptionMap = map[string]string{}
	system_setting.ServerAddress = "https://www.example.com"
	*settings = system_setting.PasskeySettings{Enabled: true, RPID: "example.com"}

	for _, origins := range []string{"https://www.example.com,https://private.example.com", "", "[]"} {
		t.Run("origins="+origins, func(t *testing.T) {
			settings.Origins = origins
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(http.MethodGet, "/api/status", nil)

			GetStatus(context)

			require.Equal(t, http.StatusOK, response.Code)
			var payload struct {
				Success bool           `json:"success"`
				Data    map[string]any `json:"data"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			require.True(t, payload.Success)
			assert.NotContains(t, payload.Data, "passkey_origins")
			assert.NotContains(t, response.Body.String(), "private.example.com")
			assert.Equal(t, true, payload.Data["passkey_login"])
			// 注：本地的 GetPasskeySettings 会把空 Origins 归一化为 ServerAddress，
			// 因此这里不断言 settings.Origins 保持原值。
		})
	}
}
