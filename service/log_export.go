package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
)

const LogExportTimeout = 5 * time.Minute

var logExportLocks sync.Map

// AcquireLogExportLock permits one active export per user across nodes. The
// Redis lease outlives the bounded export and recovers after a crashed node.
func AcquireLogExportLock(ctx context.Context, userId int) (release func(), ok bool, err error) {
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	var once sync.Once
	if !common.RedisEnabled {
		if _, running := logExportLocks.LoadOrStore(userId, struct{}{}); running {
			return nil, false, nil
		}
		return func() { once.Do(func() { logExportLocks.Delete(userId) }) }, true, nil
	}
	client := common.RDB
	key, owner := fmt.Sprintf("log_export:%d", userId), common.GetRandomString(32)
	ok, err = client.SetNX(ctx, key, owner, LogExportTimeout+time.Minute).Result()
	if err != nil || !ok {
		return nil, false, err
	}
	return func() {
		once.Do(func() {
			// Cancellation must not prevent releasing our own lease.
			releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if err := client.Eval(releaseCtx, `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`, []string{key}, owner).Err(); err != nil {
				common.SysError("failed to release log export lock: " + err.Error())
			}
		})
	}, true, nil
}
