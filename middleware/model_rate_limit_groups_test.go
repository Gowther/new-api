package middleware

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestModelRateLimitCountsConfiguredGroupsSeparately(t *testing.T) {
	oldEnabled, oldMinutes := setting.ModelRequestRateLimitEnabled, setting.ModelRequestRateLimitDurationMinutes
	oldTotal, oldSuccess := setting.ModelRequestRateLimitCount, setting.ModelRequestRateLimitSuccessCount
	oldGroups, oldRedis := setting.ModelRequestRateLimitGroup, common.RedisEnabled
	t.Cleanup(func() {
		setting.ModelRequestRateLimitEnabled, setting.ModelRequestRateLimitDurationMinutes = oldEnabled, oldMinutes
		setting.ModelRequestRateLimitCount, setting.ModelRequestRateLimitSuccessCount = oldTotal, oldSuccess
		setting.ModelRequestRateLimitGroup, common.RedisEnabled = oldGroups, oldRedis
	})
	setting.ModelRequestRateLimitEnabled, setting.ModelRequestRateLimitDurationMinutes = true, 1
	// Share one Redis client across cases because the token bucket retains it.
	useRateLimitMiniRedis(t)
	userID := 7300000
	for _, redisEnabled := range []bool{false, true} {
		for _, counts := range [][2]int{{1, 0}, {0, 1}} {
			for _, useTokenGroup := range []bool{false, true} {
				t.Run(fmt.Sprintf("redis=%t/counts=%v/token-group=%t", redisEnabled, counts, useTokenGroup), func(t *testing.T) {
					common.RedisEnabled = redisEnabled
					setting.ModelRequestRateLimitCount, setting.ModelRequestRateLimitSuccessCount = counts[0], counts[1]
					setting.ModelRequestRateLimitGroup = map[string][2]int{"a": counts, "b": counts}
					userID += 2
					router := gin.New()
					router.GET("/:user/:group", func(c *gin.Context) {
						id, _ := strconv.Atoi(c.Param("user"))
						c.Set("id", id)
						common.SetContextKey(c, constant.ContextKeyUserGroup, c.Param("group"))
						if useTokenGroup {
							common.SetContextKey(c, constant.ContextKeyUserGroup, "ignored")
							common.SetContextKey(c, constant.ContextKeyTokenGroup, c.Param("group"))
						}
					}, ModelRequestRateLimit(), func(c *gin.Context) { c.Status(http.StatusOK) })
					for _, step := range []struct {
						group        string
						user, status int
					}{
						{"a", userID, 200}, {"a", userID, 429},
						{"b", userID, 200}, {"b", userID, 429},
						{"c", userID, 200}, {"d", userID, 429},
						{"a", userID + 1, 200}, {"d", userID + 1, 200},
					} {
						response := httptest.NewRecorder()
						router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, fmt.Sprintf("/%d/%s", step.user, step.group), nil))
						assert.Equal(t, step.status, response.Code, "user=%d group=%s: %s", step.user, step.group, response.Body.String())
					}
				})
			}
		}
	}
}
