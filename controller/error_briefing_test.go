package controller

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildErrorBriefingPromptReportsPartialCoverage(t *testing.T) {
	first := &model.ErrorLogProblem{
		Scope:                  model.ErrorProblemScopeChannel,
		ChannelId:              12,
		ChannelName:            "upstream-a",
		StatusCode:             401,
		Severity:               "critical",
		Trend:                  "rising",
		Count:                  3,
		AffectedRequests:       2,
		AffectedUsers:          1,
		NormalizedErrorSummary: "invalid token <token>",
	}
	second := &model.ErrorLogProblem{Count: 4}
	summary := &model.ErrorLogSummaryResponse{
		Items:       []*model.ErrorLogSummaryItem{{}, {}},
		Problems:    []*model.ErrorLogProblem{first, second},
		ScannedLogs: 10,
		TotalLogs:   12,
		Truncated:   true,
		StartTime:   100,
		EndTime:     7300,
	}

	prompt := buildErrorBriefingPrompt([]*model.ErrorLogProblem{first}, summary, false, "Chinese")

	assert.Contains(t, prompt, "Preferred briefing language: Chinese")
	assert.Contains(t, prompt, "Visible clusters: 2, representing 7 analyzed errors, folded into 2 problems")
	assert.Contains(t, prompt, "Problems supplied: 1 of 2, representing 3 errors")
	assert.Contains(t, prompt, `error="invalid token <token>"`)
	assert.Contains(t, prompt, "analysis truncated")
}

func TestErrorBriefingErrorTextMasksAndTruncatesRawTelemetry(t *testing.T) {
	problem := &model.ErrorLogProblem{
		ErrorSummary:           "request failed at https://private.example.com/" + strings.Repeat("x", errorBriefingErrorTextLimit),
		NormalizedErrorSummary: "request failed at <url>",
	}

	assert.Equal(t, "request failed at <url>", errorBriefingErrorText(problem, false))
	raw := errorBriefingErrorText(problem, true)
	assert.NotContains(t, raw, "private.example.com")
	assert.LessOrEqual(t, len([]rune(raw)), errorBriefingErrorTextLimit+3)
}

func TestErrorBriefingErrorTextRedactsCredentialShapedTelemetry(t *testing.T) {
	tests := []struct {
		name       string
		telemetry  string
		credential string
	}{
		{
			name:       "structured authorization header",
			telemetry:  `{"authorization":"Bearer field-secret-abcdefghijklmnopqrstuvwxyz"}`,
			credential: "field-secret-abcdefghijklmnopqrstuvwxyz",
		},
		{
			name:       "OpenAI-style key",
			telemetry:  "upstream rejected sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
			credential: "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
		},
		{
			name:       "Google API key",
			telemetry:  "upstream rejected AIzaABCDEFGHIJKLMNOPQRSTUVWXYZ",
			credential: "AIzaABCDEFGHIJKLMNOPQRSTUVWXYZ",
		},
		{
			name:       "JWT",
			telemetry:  "upstream rejected eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGVyYXRvciJ9.signaturepart123456",
			credential: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGVyYXRvciJ9.signaturepart123456",
		},
		{
			name:       "AWS access key",
			telemetry:  "upstream rejected AKIAAAAAAAAAAAAAAAAA",
			credential: "AKIAAAAAAAAAAAAAAAAA",
		},
		{
			name:       "GitHub token",
			telemetry:  "upstream rejected ghp_abcdefghijklmnopqrstuvwxyz0123456789",
			credential: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			problem := &model.ErrorLogProblem{
				ErrorSummary:           tt.telemetry,
				NormalizedErrorSummary: tt.telemetry,
			}
			for _, includeRawErrorText := range []bool{false, true} {
				text := errorBriefingErrorText(problem, includeRawErrorText)

				assert.NotContains(t, text, tt.credential)
				assert.Contains(t, text, "***")
			}
		})
	}
}

func TestExtractErrorBriefingText(t *testing.T) {
	t.Run("success", func(t *testing.T) {
		response := &http.Response{
			StatusCode: http.StatusOK,
			Body: io.NopCloser(strings.NewReader(
				`{"choices":[{"message":{"role":"assistant","content":"  concise briefing  "}}]}`,
			)),
		}

		briefing, err := extractErrorBriefingText(response)

		require.NoError(t, err)
		assert.Equal(t, "concise briefing", briefing)
	})

	t.Run("masked relay error", func(t *testing.T) {
		response := &http.Response{
			StatusCode: http.StatusBadGateway,
			Body: io.NopCloser(strings.NewReader(
				`{"error":{"message":"failed at https://private.example.com/v1","type":"upstream_error"}}`,
			)),
		}

		_, err := extractErrorBriefingText(response)

		require.Error(t, err)
		assert.Contains(t, err.Error(), "status 502")
		assert.NotContains(t, err.Error(), "private.example.com")
	})

	t.Run("invalid error response", func(t *testing.T) {
		response := &http.Response{
			StatusCode: http.StatusServiceUnavailable,
			Body:       io.NopCloser(strings.NewReader("not-json")),
		}

		_, err := extractErrorBriefingText(response)

		require.EqualError(t, err, "briefing relay failed with status 503 (Service Unavailable)")
	})
}

func TestErrorBriefingLanguage(t *testing.T) {
	tests := map[string]string{
		"zh-CN": "Chinese",
		"fr-FR": "French",
		"ja":    "Japanese",
		"ru":    "Russian",
		"vi":    "Vietnamese",
		"xx":    "English",
		"":      "English",
	}

	for input, expected := range tests {
		t.Run(input, func(t *testing.T) {
			assert.Equal(t, expected, errorBriefingLanguage(input))
		})
	}
}

func TestErrorBriefingRelayPathUsesPlaygroundBilling(t *testing.T) {
	gin.SetMode(gin.TestMode)
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Request = httptest.NewRequest(http.MethodPost, errorBriefingRelayPath, strings.NewReader(`{}`))

	relayInfo := relaycommon.GenRelayInfoOpenAI(context, &dto.GeneralOpenAIRequest{})

	assert.True(t, relayInfo.IsPlayground)
	assert.Equal(t, "/v1/chat/completions", relayInfo.RequestURLPath)
}
