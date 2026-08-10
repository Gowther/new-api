package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestBeginAdminAuditSkipsReadOnlyPostRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)

	tests := []struct {
		name      string
		route     string
		wantAudit bool
	}{
		{
			name:      "model vendor grouping preview",
			route:     "/api/channel/model_vendor_groups",
			wantAudit: false,
		},
		{
			name:      "ordinary administrative post",
			route:     "/api/channel/",
			wantAudit: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router := gin.New()
			var auditWriter *auditResponseWriter
			router.POST(test.route, func(c *gin.Context) {
				auditWriter = beginAdminAudit(c)
				c.Status(http.StatusNoContent)
			})

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, test.route, nil)
			router.ServeHTTP(recorder, request)

			require.Equal(t, http.StatusNoContent, recorder.Code)
			if test.wantAudit {
				require.NotNil(t, auditWriter)
			} else {
				require.Nil(t, auditWriter)
			}
		})
	}
}
