package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	"github.com/gin-gonic/gin"
)

func RegisterTokenUsageDataRoutes(apiRouter *gin.RouterGroup) {
	apiRouter.GET("/token_usage/self", middleware.UserAuth(), controller.GetTokenUsageSelf)
}
