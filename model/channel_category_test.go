package model

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/stretchr/testify/assert"
)

func TestChannelGetCategory(t *testing.T) {
	tests := []struct {
		name         string
		channelName  string
		channelType  int
		baseURL      string
		wantCategory ChannelCategory
	}{
		{name: "welfare prefix overrides URL", channelName: "公益站一号", baseURL: "https://api.openai.com", wantCategory: ChannelCategoryWelfare},
		{name: "third party prefix overrides URL", channelName: "三方-共享官方 Key", baseURL: "http://host.docker.internal:3000", wantCategory: ChannelCategoryThirdParty},
		{name: "temporary prefix", channelName: "临时-测试 Key", baseURL: "https://api.openai.com", wantCategory: ChannelCategoryTemporary},
		{name: "docker host", channelName: "自建 OpenAI", baseURL: "http://host.docker.internal:3000", wantCategory: ChannelCategorySelfHosted},
		{name: "compose service name", channelName: "自建服务", baseURL: "http://one-api:3000", wantCategory: ChannelCategorySelfHosted},
		{name: "localhost", channelName: "本地服务", baseURL: "http://localhost:11434", wantCategory: ChannelCategorySelfHosted},
		{name: "private IPv4", channelName: "局域网服务", baseURL: "http://192.168.1.10/v1", wantCategory: ChannelCategorySelfHosted},
		{name: "private IPv6", channelName: "局域网 IPv6", baseURL: "http://[fd00::10]:8080", wantCategory: ChannelCategorySelfHosted},
		{name: "local domain", channelName: "本地域名", baseURL: "https://gateway.home.arpa", wantCategory: ChannelCategorySelfHosted},
		{name: "public domain", channelName: "OpenAI", baseURL: "https://api.openai.com", wantCategory: ChannelCategoryOfficial},
		{name: "default Ollama URL", channelName: "Ollama", channelType: constant.ChannelTypeOllama, wantCategory: ChannelCategorySelfHosted},
		{name: "default OpenAI URL", channelName: "OpenAI", channelType: constant.ChannelTypeOpenAI, wantCategory: ChannelCategoryOfficial},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			baseURL := test.baseURL
			channel := Channel{
				Name:    test.channelName,
				Type:    test.channelType,
				BaseURL: &baseURL,
			}
			assert.Equal(t, test.wantCategory, channel.GetCategory())
		})
	}
}

func TestParseChannelCategory(t *testing.T) {
	assert.Equal(t, ChannelCategorySelfHosted, ParseChannelCategory(" SELF_HOSTED "))
	assert.Empty(t, ParseChannelCategory("unsupported"))
}
