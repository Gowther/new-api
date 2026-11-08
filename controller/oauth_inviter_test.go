package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOAuthRegistrationPersistsInviter(t *testing.T) {
	oldDB, oldLogDB := model.DB, model.LOG_DB
	oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
	oldRedis, oldRegister := common.RedisEnabled, common.RegisterEnabled
	oldNew, oldInvitee, oldInviter := common.QuotaForNewUser, common.QuotaForInvitee, common.QuotaForInviter
	db := setupModelListControllerTestDB(t)
	common.RegisterEnabled = true
	common.QuotaForNewUser, common.QuotaForInvitee, common.QuotaForInviter = 0, 0, 0
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetDatabaseTypes(oldMain, oldLog)
		common.RedisEnabled, common.RegisterEnabled = oldRedis, oldRegister
		common.QuotaForNewUser, common.QuotaForInvitee, common.QuotaForInviter = oldNew, oldInvitee, oldInviter
	})
	inviter := model.User{Username: "inviter", AffCode: "valid-aff", Status: common.UserStatusEnabled}
	require.NoError(t, db.Create(&inviter).Error)
	for _, tc := range []struct {
		name, code string
		want       int
	}{
		{"valid", "valid-aff", inviter.Id}, {"missing", "", 0}, {"invalid", "unknown-aff", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			router := gin.New()
			router.Use(sessions.Sessions("session", cookie.NewStore([]byte("oauth-inviter-test"))))
			router.GET("/", func(c *gin.Context) {
				session := sessions.Default(c)
				session.Set("aff", tc.code)
				provider := &oauth.GitHubProvider{}
				identity := &oauth.OAuthUser{ProviderUserID: "inviter-test-" + tc.name, Username: "oauth-" + tc.name}
				created, err := findOrCreateOAuthUser(c, provider, identity, session)
				require.NoError(t, err)
				var stored model.User
				require.NoError(t, db.First(&stored, created.Id).Error)
				assert.Equal(t, tc.want, stored.InviterId)
				assert.Equal(t, identity.ProviderUserID, stored.GitHubId)
				session.Set("aff", "valid-aff")
				existing, err := findOrCreateOAuthUser(c, provider, identity, session)
				require.NoError(t, err)
				assert.Equal(t, created.Id, existing.Id)
				require.NoError(t, db.First(&stored, created.Id).Error)
				assert.Equal(t, tc.want, stored.InviterId, "login must not reassign the inviter")
				c.Status(http.StatusNoContent)
			})
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))
			assert.Equal(t, http.StatusNoContent, recorder.Code)
		})
	}
}
