package model

import (
	"context"
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// buildLogSearchQuery is shared by list and export, including the local
// wildcard and success-rate semantics. The caller supplies the authorized scope.
func buildLogSearchQuery(tx *gorm.DB, filter LogStatQuery) (*gorm.DB, error) {
	tx = tx.Model(&Log{})
	if filter.UserId != 0 {
		tx = tx.Where("logs.user_id = ?", filter.UserId)
	}
	if filter.LogType != LogTypeUnknown {
		tx = tx.Where("logs.type = ?", filter.LogType)
	}
	var err error
	if tx, err = applyLogModelNameFilter(tx, "logs.model_name", filter.ModelName); err != nil {
		return nil, err
	}
	if tx, err = applyExplicitLogTextFilter(tx, "logs.username", filter.Username); err != nil {
		return nil, err
	}
	if filter.TokenName != "" {
		tx = tx.Where("logs.token_name = ?", filter.TokenName)
	}
	if filter.RequestId != "" {
		tx = tx.Where("logs.request_id = ?", filter.RequestId)
	}
	if filter.UpstreamRequestId != "" {
		tx = tx.Where("logs.upstream_request_id = ?", filter.UpstreamRequestId)
	}
	if filter.StartTimestamp != 0 {
		tx = tx.Where("logs.created_at >= ?", filter.StartTimestamp)
	}
	if filter.EndTimestamp != 0 {
		tx = tx.Where("logs.created_at <= ?", filter.EndTimestamp)
	}
	if filter.Channel != 0 {
		tx = tx.Where("logs.channel_id = ?", filter.Channel)
	}
	if filter.Group != "" {
		tx = tx.Where("logs."+logGroupCol+" = ?", filter.Group)
	}
	return applyLogResultFilter(tx, "logs.", filter.Result), nil
}

// StreamLogs uses one database cursor so exports do not repeat or skip rows
// when new requests arrive, or allocate the whole result in memory. This also
// supports ClickHouse, whose log IDs are synthesized only for display.
func StreamLogs(ctx context.Context, filter LogStatQuery, admin bool, write func(*Log) error) error {
	if !admin {
		if filter.UserId <= 0 {
			return errors.New("user scope is required")
		}
		filter.Username, filter.Channel = "", 0
	}
	tx, err := buildLogSearchQuery(LOG_DB.WithContext(ctx), filter)
	if err != nil {
		return err
	}
	// Read channel display data before opening the log cursor: the main and log
	// databases may share a single SQLite connection. Never query channel keys.
	channelNames := make(map[int]string)
	if admin {
		var channels []struct {
			Id   int
			Name string
		}
		if err := DB.WithContext(ctx).Table("channels").Select("id, name").Find(&channels).Error; err != nil {
			return err
		}
		for _, channel := range channels {
			channelNames[channel.Id] = channel.Name
		}
	}
	order := "logs.id desc"
	if admin {
		order = "logs.created_at desc, logs.id desc"
	}
	if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
		order = clickHouseLogOrder("logs.")
	}
	rows, err := tx.Order(order).Rows()
	if err != nil {
		return err
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		if err := ctx.Err(); err != nil {
			return err
		}
		entry := &Log{}
		if err := LOG_DB.ScanRows(rows, entry); err != nil {
			return err
		}
		if admin {
			entry.ChannelName = channelNames[entry.ChannelId]
			if common.UsingLogDatabase(common.DatabaseTypeClickHouse) {
				entry.Id = count + 1
			}
		} else {
			formatUserLogs([]*Log{entry}, count)
			entry.ChannelId, entry.ChannelRemark = 0, ""
		}
		if err := write(entry); err != nil {
			return err
		}
		count++
	}
	return rows.Err()
}
