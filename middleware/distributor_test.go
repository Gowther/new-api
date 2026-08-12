package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGetModelFromJSONBodyParsesPlaygroundChannelID(t *testing.T) {
	gin.SetMode(gin.TestMode)

	request := httptest.NewRequest(http.MethodPost, "/pg/chat/completions", strings.NewReader(`{"model":"gpt-4o","group":"default","channel_id":42}`))
	request.Header.Set("Content-Type", "application/json")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = request

	modelRequest, err := getModelFromJSONBody(context)

	require.NoError(t, err)
	require.Equal(t, "gpt-4o", modelRequest.Model)
	require.Equal(t, "default", modelRequest.Group)
	require.NotNil(t, modelRequest.ChannelId)
	require.Equal(t, 42, *modelRequest.ChannelId)
}

func TestGetModelFromJSONBodyRejectsInvalidPlaygroundChannelID(t *testing.T) {
	gin.SetMode(gin.TestMode)

	request := httptest.NewRequest(http.MethodPost, "/pg/chat/completions", strings.NewReader(`{"model":"gpt-4o","channel_id":"42"}`))
	request.Header.Set("Content-Type", "application/json")
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = request

	_, err := getModelFromJSONBody(context)

	require.Error(t, err)
	require.ErrorContains(t, err, "channel_id must be a positive integer")
}

func TestChannelSupportsPlaygroundPath(t *testing.T) {
	settings, err := common.Marshal(dto.ChannelOtherSettings{
		AdvancedCustom: &dto.AdvancedCustomConfig{Routes: []dto.AdvancedCustomRoute{{IncomingPath: "/v1/chat/completions"}}},
	})
	require.NoError(t, err)
	channel := &model.Channel{
		Type:          constant.ChannelTypeAdvancedCustom,
		OtherSettings: string(settings),
	}

	require.True(t, channelSupportsRequestPath(channel, "/pg/chat/completions"))
	require.False(t, channelSupportsRequestPath(channel, "/pg/responses"))
}

func TestDistributeSpecificChannelBypassesModelRoutingOverride(t *testing.T) {
	originalDB := model.DB
	originalMemoryCacheEnabled := common.MemoryCacheEnabled
	originalMainDatabaseType := common.MainDatabaseType()
	originalLogDatabaseType := common.LogDatabaseType()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)

	model.DB = db
	common.MemoryCacheEnabled = false
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, originalLogDatabaseType)
	t.Cleanup(func() {
		model.DB = originalDB
		common.MemoryCacheEnabled = originalMemoryCacheEnabled
		common.SetDatabaseTypes(originalMainDatabaseType, originalLogDatabaseType)
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}, &model.ModelRoutingOverride{}))

	const modelName = "specific-channel-override-model"
	channels := []model.Channel{
		{Id: 92001, Name: "temporary target", Key: "target-key", Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Models: modelName, Group: "default"},
		{Id: 92002, Name: "explicit target", Key: "explicit-key", Type: constant.ChannelTypeOpenAI, Status: common.ChannelStatusEnabled, Models: modelName, Group: "default"},
	}
	for i := range channels {
		require.NoError(t, db.Create(&channels[i]).Error)
		require.NoError(t, channels[i].UpdateAbilities(nil))
	}
	_, err = model.SetModelRoutingOverride(modelName, channels[0].Id)
	require.NoError(t, err)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	selectedChannelID := 0
	overrideApplied := true
	router.POST(
		"/v1/chat/completions",
		func(c *gin.Context) {
			common.SetContextKey(c, constant.ContextKeyTokenSpecificChannelId, "92002")
		},
		Distribute(),
		func(c *gin.Context) {
			selectedChannelID = common.GetContextKeyInt(c, constant.ContextKeyChannelId)
			overrideApplied = common.GetContextKeyBool(c, constant.ContextKeyModelRoutingOverride)
			c.Status(http.StatusNoContent)
		},
	)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"specific-channel-override-model"}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusNoContent, recorder.Code)
	assert.Equal(t, channels[1].Id, selectedChannelID)
	assert.False(t, overrideApplied)
}
