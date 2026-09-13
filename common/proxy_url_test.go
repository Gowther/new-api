package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseProxyURLStrict(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		raw     string
		wantURL string
		wantErr bool
	}{
		{name: "empty passes through", raw: "", wantErr: false},
		{name: "http with port", raw: "http://proxy.local:8080", wantURL: "http://proxy.local:8080"},
		{name: "scheme case normalized", raw: "HTTP://proxy.local:8080", wantURL: "http://proxy.local:8080"},
		{name: "https with userinfo", raw: "https://user:pass@proxy.local:443", wantURL: "https://user:pass@proxy.local:443"},
		{name: "socks5 default port appended", raw: "socks5://proxy.local", wantURL: "socks5://proxy.local:1080"},
		{name: "socks5h with userinfo", raw: "socks5h://alice:secret@proxy.local:1080", wantURL: "socks5h://alice:secret@proxy.local:1080"},
		{name: "unsupported scheme rejected", raw: "ftp://proxy.local:21", wantErr: true},
		{name: "javascript scheme rejected", raw: "javascript:alert(1)", wantErr: true},
		{name: "missing host rejected", raw: "http://", wantErr: true},
		{name: "out of range port rejected", raw: "http://proxy.local:99999", wantErr: true},
		{name: "non numeric port rejected", raw: "http://proxy.local:abc", wantErr: true},
		{name: "query rejected", raw: "http://proxy.local:8080?key=value", wantErr: true},
		{name: "fragment rejected", raw: "http://proxy.local:8080#frag", wantErr: true},
		{name: "path rejected", raw: "http://proxy.local:8080/proxy", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parsed, err := ParseProxyURLStrict(tt.raw)
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			if tt.wantURL == "" {
				assert.Nil(t, parsed)
				return
			}
			require.NotNil(t, parsed)
			assert.Equal(t, tt.wantURL, parsed.String())
		})
	}
}

func TestParseProxyURLRuntimeStripsLegacySuffix(t *testing.T) {
	t.Parallel()

	parsed, stripped, err := ParseProxyURLRuntime("http://proxy.local:8080/proxy?key=value#frag")
	require.NoError(t, err)
	require.NotNil(t, parsed)
	assert.True(t, stripped)
	assert.Equal(t, "http://proxy.local:8080", parsed.String())

	parsed, stripped, err = ParseProxyURLRuntime("http://proxy.local:8080")
	require.NoError(t, err)
	require.NotNil(t, parsed)
	assert.False(t, stripped)
	assert.Equal(t, "http://proxy.local:8080", parsed.String())
}
