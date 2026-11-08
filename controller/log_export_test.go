package controller

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLogExportScopesFiltersAndCompletion(t *testing.T) {
	db := setupModelListControllerTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}))
	now := common.GetTimestamp()
	entries := []model.Log{
		{Id: 11, UserId: 1, Username: "alice", Type: model.LogTypeConsume, CreatedAt: now - 10, ModelName: "gpt_x", TokenName: "key", Group: "vip", ChannelId: 2, PromptTokens: 10, CompletionTokens: 5, RequestId: "target", UpstreamRequestId: "upstream-target", Other: `{"cache_tokens":3,"admin_info":{"secret":"hidden"},"audit_info":{"route":"hidden"},"channel_name":"hidden","reject_reason":"hidden"}`},
		{Id: 12, UserId: 2, Username: "bob", Type: model.LogTypeConsume, CreatedAt: now - 10, ModelName: "gpt_x", TokenName: "key", Group: "vip", ChannelId: 2, PromptTokens: 10, CompletionTokens: 5, RequestId: "other-user"},
		{Id: 13, UserId: 1, Username: "alice", Type: model.LogTypeError, CreatedAt: now - 5, ModelName: "gpt_y", Group: "default", RequestId: "failed"},
		{Id: 14, UserId: 1, Username: "alice", Type: model.LogTypeConsume, CreatedAt: now - 2, ModelName: "gpt_y", PromptTokens: 10, RequestId: "empty-completion"},
	}
	require.NoError(t, db.Create(&entries).Error)
	require.NoError(t, db.Create(&model.Channel{Id: 2, Name: "provider"}).Error)
	for _, tc := range []struct {
		name, query string
		admin       bool
		want        []string
	}{
		{"admin all", "", true, []string{"empty-completion", "failed", "other-user", "target"}},
		{"success", "result=success", true, []string{"other-user", "target"}},
		{"failure", "result=failed", true, []string{"empty-completion", "failed"}},
		{"all local filters", fmt.Sprintf("username=alice&channel=2&model_name=gpt_x&token_name=key&group=vip&type=2&request_id=target&upstream_request_id=upstream-target&start_timestamp=%d&end_timestamp=%d", now-20, now), true, []string{"target"}},
		{"own scope ignores admin selectors", "username=bob&channel=999&user_id=2", false, []string{"empty-completion", "failed", "target"}},
		{"own request id", "upstream_request_id=upstream-target", false, []string{"target"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			writer := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(writer)
			c.Set("id", 1)
			c.Set("role", common.RoleCommonUser)
			c.Request = httptest.NewRequest(http.MethodGet, "/export?"+tc.query, nil)
			if tc.admin {
				c.Set("role", common.RoleAdminUser)
				ExportAllLogs(c)
			} else {
				ExportUserLogs(c)
			}
			require.Equal(t, http.StatusOK, writer.Code)
			assert.Contains(t, writer.Header().Get("Content-Type"), "application/x-ndjson")
			assert.Equal(t, "no-store", writer.Header().Get("Cache-Control"))
			lines := strings.Split(strings.TrimSpace(writer.Body.String()), "\n")
			require.Len(t, lines, len(tc.want)+1)
			var ids []string
			for i, line := range lines[:len(lines)-1] {
				var entry model.Log
				require.NoError(t, common.UnmarshalJsonStr(line, &entry))
				ids = append(ids, entry.RequestId)
				if !tc.admin {
					assert.Equal(t, 1, entry.UserId)
					assert.Equal(t, i+1, entry.Id)
					assert.Zero(t, entry.ChannelId)
					assert.Empty(t, entry.ChannelName)
					assert.NotContains(t, line, "hidden")
				}
				if entry.RequestId == "target" {
					assert.Contains(t, entry.Other, "cache_tokens")
					if tc.admin {
						assert.Contains(t, entry.Other, "hidden")
						assert.Equal(t, "provider", entry.ChannelName)
					}
				}
			}
			assert.Equal(t, tc.want, ids)
			var terminal struct {
				Success bool
				Data    struct{ Count int }
			}
			require.NoError(t, common.UnmarshalJsonStr(lines[len(lines)-1], &terminal))
			assert.True(t, terminal.Success)
			assert.Equal(t, len(tc.want), terminal.Data.Count)
		})
	}
	// The list's zero user ID must remain scoped even after sharing filters.
	logs, _, err := model.GetUserLogs(0, 0, 0, 0, "", "", 0, 100, "", "", "", "")
	require.NoError(t, err)
	assert.Empty(t, logs)
	// Closing the cursor on a write error must free the single SQLite connection.
	sentinel := errors.New("client disconnected")
	err = model.StreamLogs(context.Background(), model.LogStatQuery{UserId: 1}, false, func(*model.Log) error { return sentinel })
	assert.ErrorIs(t, err, sentinel)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	var count int64
	require.NoError(t, db.WithContext(ctx).Model(&model.Log{}).Count(&count).Error)
	assert.EqualValues(t, 4, count)
}

func TestLogExportRejectsInvalidRangesAndUnauthorizedScope(t *testing.T) {
	for _, tc := range []struct {
		query      string
		user, role int
		admin      bool
		status     int
	}{
		{"", 0, 0, false, 401}, {"", 1, common.RoleCommonUser, true, 403},
		{"start_timestamp=bad", 1, common.RoleCommonUser, false, 200},
		{"start_timestamp=-1", 1, common.RoleCommonUser, false, 200},
		{"start_timestamp=200&end_timestamp=100", 1, common.RoleCommonUser, false, 200},
		{"start_timestamp=1", 1, common.RoleCommonUser, false, 200},
	} {
		writer := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(writer)
		c.Set("id", tc.user)
		c.Set("role", tc.role)
		c.Request = httptest.NewRequest(http.MethodGet, "/export?"+tc.query, nil)
		exportLogs(c, tc.admin)
		assert.Equal(t, tc.status, writer.Code)
		if tc.status == 200 {
			assert.Contains(t, writer.Body.String(), `"success":false`)
		}
	}
}
