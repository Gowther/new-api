package common

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNormalizeRequestPath(t *testing.T) {
	tests := []struct {
		name        string
		requestPath string
		want        string
	}{
		{name: "playground chat", requestPath: "/pg/chat/completions", want: "/v1/chat/completions"},
		{name: "playground root", requestPath: "/pg", want: "/v1"},
		{name: "public relay", requestPath: "/v1/responses", want: "/v1/responses"},
		{name: "unrelated prefix", requestPath: "/pgraphql", want: "/pgraphql"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, NormalizeRequestPath(tt.requestPath))
		})
	}
}
