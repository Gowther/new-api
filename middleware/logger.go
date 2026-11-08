package middleware

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

const RouteTagKey = "route_tag"

func RouteTag(tag string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(RouteTagKey, tag)
		c.Next()
	}
}

func SetUpLogger(server *gin.Engine) {
	server.Use(gin.LoggerWithFormatter(func(param gin.LogFormatterParams) string {
		var requestID string
		if param.Keys != nil {
			requestID, _ = param.Keys[common.RequestIdKey].(string)
		}
		tag, _ := param.Keys[RouteTagKey].(string)
		if tag == "" {
			tag = "web"
		}
		path := param.Path
		// Redact only the logged copy; handlers still need the original query.
		if strings.HasPrefix(param.Request.URL.Path, "/api/oauth/") || strings.HasPrefix(param.Request.URL.Path, "/oauth/") {
			path = param.Request.URL.Path
		} else if param.Request.URL.RawQuery != "" {
			query := param.Request.URL.Query()
			for key := range query {
				normalized := strings.ToLower(strings.TrimSpace(key))
				sensitive := strings.Contains(normalized, "token") || strings.Contains(normalized, "secret") || strings.Contains(normalized, "signature")
				switch normalized {
				case "key", "api_key", "api-key", "apikey", "x-api-key", "authorization", "auth", "password", "passwd", "sig", "awsaccesskeyid", "x-amz-credential":
					sensitive = true
				}
				if sensitive {
					query.Set(key, "***masked***")
				}
			}
			path = param.Request.URL.EscapedPath() + "?" + query.Encode()
		}
		return fmt.Sprintf("[GIN] %s | %s | %s | %3d | %13v | %15s | %7s %s\n",
			param.TimeStamp.Format("2006/01/02 - 15:04:05"),
			tag,
			requestID,
			param.StatusCode,
			param.Latency,
			param.ClientIP,
			param.Method,
			path,
		)
	}))
}
