package middleware

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupAuthTestDB swaps model.DB for an in-memory SQLite database.
func setupAuthTestDB(t *testing.T) *gorm.DB {
	t.Helper()

	originalDB := model.DB
	originalRedisEnabled := common.RedisEnabled
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)

	model.DB = db
	common.RedisEnabled = false
	t.Cleanup(func() {
		model.DB = originalDB
		common.RedisEnabled = originalRedisEnabled
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&model.User{}))
	return db
}

// authTestRouter exposes a login route that snapshots the user's current
// role/status into a session cookie, plus routes guarded by UserAuth/AdminAuth.
func authTestRouter(user *model.User) *gin.Engine {
	router := gin.New()
	router.Use(sessions.Sessions("session", cookie.NewStore([]byte("auth-revalidation-test"))))
	router.GET("/login", func(c *gin.Context) {
		session := sessions.Default(c)
		session.Set("username", user.Username)
		session.Set("role", user.Role)
		session.Set("id", user.Id)
		session.Set("status", user.Status)
		session.Set("group", user.Group)
		if err := session.Save(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"success": false})
			return
		}
		c.Status(http.StatusNoContent)
	})
	reached := func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"success": true, "reached": true})
	}
	router.GET("/api/user", UserAuth(), reached)
	router.GET("/api/admin", AdminAuth(), reached)
	return router
}

func authLoginCookies(t *testing.T, router *gin.Engine) []*http.Cookie {
	t.Helper()
	loginRecorder := httptest.NewRecorder()
	router.ServeHTTP(loginRecorder, httptest.NewRequest(http.MethodGet, "/login", nil))
	require.Equal(t, http.StatusNoContent, loginRecorder.Code)
	return loginRecorder.Result().Cookies()
}

func authRequest(router *gin.Engine, path string, userId int, cookies []*http.Cookie) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	request.Header.Set("New-Api-User", strconv.Itoa(userId))
	for _, c := range cookies {
		request.AddCookie(c)
	}
	router.ServeHTTP(recorder, request)
	return recorder
}

func assertReached(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()
	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Contains(t, recorder.Body.String(), `"reached":true`)
}

func assertRejected(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()
	assert.Contains(t, recorder.Body.String(), `"success":false`)
	assert.NotContains(t, recorder.Body.String(), `"reached":true`)
}

// A session stays valid while the user is enabled and keeps its role.
func TestAuthHelperSessionPassesForUntouchedUser(t *testing.T) {
	db := setupAuthTestDB(t)
	gin.SetMode(gin.TestMode)

	user := &model.User{Username: "admin-user", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, Group: "default"}
	require.NoError(t, db.Create(user).Error)

	router := authTestRouter(user)
	cookies := authLoginCookies(t, router)

	assertReached(t, authRequest(router, "/api/user", user.Id, cookies))
	assertReached(t, authRequest(router, "/api/admin", user.Id, cookies))
}

// Disabling a user must invalidate existing sessions, not just new logins:
// authHelper re-reads status from the user cache/DB instead of trusting the
// long-lived session cookie.
func TestAuthHelperSessionRejectsDisabledUser(t *testing.T) {
	db := setupAuthTestDB(t)
	gin.SetMode(gin.TestMode)

	user := &model.User{Username: "soon-disabled", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default"}
	require.NoError(t, db.Create(user).Error)

	router := authTestRouter(user)
	cookies := authLoginCookies(t, router)
	assertReached(t, authRequest(router, "/api/user", user.Id, cookies))

	require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("status", common.UserStatusDisabled).Error)
	assertRejected(t, authRequest(router, "/api/user", user.Id, cookies))
}

// Demoting an admin must revoke admin-area access for existing sessions:
// the role check runs against the fresh role, not the one baked into the cookie.
func TestAuthHelperSessionRejectsDemotedAdmin(t *testing.T) {
	db := setupAuthTestDB(t)
	gin.SetMode(gin.TestMode)

	user := &model.User{Username: "soon-demoted", Role: common.RoleAdminUser, Status: common.UserStatusEnabled, Group: "default"}
	require.NoError(t, db.Create(user).Error)

	router := authTestRouter(user)
	cookies := authLoginCookies(t, router)
	assertReached(t, authRequest(router, "/api/admin", user.Id, cookies))

	require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Update("role", common.RoleCommonUser).Error)
	assertRejected(t, authRequest(router, "/api/admin", user.Id, cookies))
	// Demotion must not lock the user out of common-user routes.
	assertReached(t, authRequest(router, "/api/user", user.Id, cookies))
}
