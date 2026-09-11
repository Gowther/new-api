package service

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSendWebhookNotifySubstituteValues 验证 webhook 通知内容与邮件/其他通知方式一致，
// 使用 {{value}} 占位符替换，而不是 fmt.Sprintf（后者会产生 %!(EXTRA ...) 垃圾内容）。
func TestSendWebhookNotifySubstituteValues(t *testing.T) {
	InitHttpClient()

	// 默认 SSRF 防护会拒绝 httptest 的内网地址和随机端口，测试期间关闭并恢复
	fetchSetting := system_setting.GetFetchSetting()
	oldSetting := *fetchSetting
	fetchSetting.EnableSSRFProtection = false
	defer func() { *fetchSetting = oldSetting }()

	var receivedBody []byte
	var receivedSignature string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var err error
		receivedBody, err = io.ReadAll(r.Body)
		require.NoError(t, err)
		receivedSignature = r.Header.Get("X-Webhook-Signature")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	notify := dto.NewNotify(
		dto.NotifyTypeQuotaExceed,
		"额度提醒",
		"{{value}}，当前剩余额度为 {{value}}，请及时充值。",
		[]interface{}{"用户额度不足", 100},
	)

	const secret = "test-secret"
	err := SendWebhookNotify(server.URL, secret, notify)
	require.NoError(t, err)

	var payload WebhookPayload
	require.NoError(t, common.Unmarshal(receivedBody, &payload))
	assert.Equal(t, dto.NotifyTypeQuotaExceed, payload.Type)
	assert.Equal(t, "用户额度不足，当前剩余额度为 100，请及时充值。", payload.Content)
	assert.NotContains(t, payload.Content, dto.ContentValueParam)
	assert.NotContains(t, payload.Content, "%!(EXTRA")
	assert.Equal(t, generateSignature(secret, receivedBody), receivedSignature)
}

// TestSendWebhookNotifyNoValues 验证无占位符参数时内容原样发送。
func TestSendWebhookNotifyNoValues(t *testing.T) {
	InitHttpClient()

	fetchSetting := system_setting.GetFetchSetting()
	oldSetting := *fetchSetting
	fetchSetting.EnableSSRFProtection = false
	defer func() { *fetchSetting = oldSetting }()

	var receivedBody []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var err error
		receivedBody, err = io.ReadAll(r.Body)
		require.NoError(t, err)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	notify := dto.NewNotify(dto.NotifyTypeChannelTest, "标题", "纯文本内容", nil)
	err := SendWebhookNotify(server.URL, "", notify)
	require.NoError(t, err)

	var payload WebhookPayload
	require.NoError(t, common.Unmarshal(receivedBody, &payload))
	assert.Equal(t, "纯文本内容", payload.Content)
	assert.False(t, strings.Contains(payload.Content, "%!"))
}
