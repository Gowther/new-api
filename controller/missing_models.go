package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

type modelRuleCoverageCheckRequest struct {
	Models []string `json:"models"`
}

// GetMissingModels returns the list of model names that are referenced by channels
// but do not have corresponding records in the models meta table.
// This helps administrators quickly discover models that need configuration.
func GetMissingModels(c *gin.Context) {
	missing, err := model.GetMissingModels()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    missing,
	})
}

func GetModelRuleCoverage(c *gin.Context) {
	addableModelNames := make([]string, 0, len(openAIModels))
	for _, aiModel := range openAIModels {
		addableModelNames = append(addableModelNames, aiModel.Id)
	}

	snapshot, err := model.GetModelRuleCoverageSnapshot(addableModelNames)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    snapshot,
	})
}

func CheckModelRuleCoverage(c *gin.Context) {
	var request modelRuleCoverageCheckRequest
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		common.ApiError(c, err)
		return
	}

	coverage, err := model.CheckModelRuleCoverage(request.Models)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    coverage,
	})
}

func GetModelPricingHealth(c *gin.Context) {
	health, err := model.GetModelPricingHealth()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    health,
	})
}

func CleanupStaleModelPricingSettings(c *gin.Context) {
	report, err := model.CleanupStaleModelPricingSettings()
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    report,
	})
}
