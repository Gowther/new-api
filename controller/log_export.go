package controller

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const maxLogExportRange = int64(365 * 24 * 60 * 60)

func ExportAllLogs(c *gin.Context)  { exportLogs(c, true) }
func ExportUserLogs(c *gin.Context) { exportLogs(c, false) }

// The last NDJSON line confirms completion. Clients must not download a
// partial stream as if it were a complete export.
func exportLogs(c *gin.Context, admin bool) {
	userId := c.GetInt("id")
	if userId <= 0 {
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	if admin && c.GetInt("role") < common.RoleAdminUser {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	filter := parseLogStatQuery(c)
	if admin {
		filter.Username = c.Query("username")
		filter.Channel, _ = strconv.Atoi(c.Query("channel"))
	} else {
		filter.UserId = userId
	}
	for _, name := range []string{"start_timestamp", "end_timestamp"} {
		if raw := c.Query(name); raw != "" {
			if _, err := strconv.ParseInt(raw, 10, 64); err != nil {
				common.ApiError(c, errors.New("Invalid export time range"))
				return
			}
		}
	}
	now := common.GetTimestamp()
	if filter.EndTimestamp == 0 || filter.EndTimestamp > now {
		filter.EndTimestamp = now
	}
	if filter.StartTimestamp == 0 {
		filter.StartTimestamp = filter.EndTimestamp - maxLogExportRange
	}
	if filter.StartTimestamp < 0 || filter.EndTimestamp < filter.StartTimestamp || filter.EndTimestamp-filter.StartTimestamp > maxLogExportRange {
		common.ApiError(c, errors.New("Log export time range cannot exceed 365 days"))
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), service.LogExportTimeout)
	defer cancel()
	release, ok, err := service.AcquireLogExportLock(ctx, userId)
	if err != nil {
		common.ApiError(c, errors.New("Failed to export logs"))
		return
	}
	if !ok {
		common.ApiError(c, errors.New("Another log export is running. Try again after it finishes."))
		return
	}
	defer release()
	c.Header("Content-Type", "application/x-ndjson; charset=utf-8")
	c.Header("Cache-Control", "no-store")
	c.Header("X-Accel-Buffering", "no")
	count := 0
	err = model.StreamLogs(ctx, filter, admin, func(entry *model.Log) error {
		line, err := common.Marshal(entry)
		if err != nil {
			return err
		}
		if _, err := c.Writer.Write(append(line, '\n')); err != nil {
			return err
		}
		count++
		if count%128 == 0 {
			c.Writer.Flush()
		}
		return nil
	})
	if c.Request.Context().Err() != nil {
		return
	}
	if err != nil {
		common.SysError("failed to export logs: " + err.Error())
		common.ApiError(c, errors.New("Failed to export logs"))
		return
	}
	common.ApiSuccess(c, gin.H{"count": count})
}
