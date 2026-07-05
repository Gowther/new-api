package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func setupPerfMetricTest(t *testing.T) {
	t.Helper()
	require.NoError(t, DB.AutoMigrate(&PerfMetric{}))
	require.NoError(t, DB.Exec("DELETE FROM perf_metrics").Error)
	t.Cleanup(func() {
		_ = DB.Exec("DELETE FROM perf_metrics").Error
	})
}

func TestUpsertPerfMetricAggregatesExistingBucket(t *testing.T) {
	setupPerfMetricTest(t)

	metric := &PerfMetric{
		ModelName:      "gpt-test",
		Group:          "default",
		BucketTs:       1700000000,
		RequestCount:   2,
		SuccessCount:   1,
		TotalLatencyMs: 300,
		TtftSumMs:      50,
		TtftCount:      1,
		OutputTokens:   100,
		GenerationMs:   400,
	}
	require.NoError(t, UpsertPerfMetric(metric))

	metric.RequestCount = 3
	metric.SuccessCount = 2
	metric.TotalLatencyMs = 700
	metric.TtftSumMs = 90
	metric.TtftCount = 2
	metric.OutputTokens = 250
	metric.GenerationMs = 800
	require.NoError(t, UpsertPerfMetric(metric))

	var row PerfMetric
	require.NoError(t, DB.First(&row, "model_name = ? AND bucket_ts = ?", "gpt-test", int64(1700000000)).Error)
	require.Equal(t, int64(5), row.RequestCount)
	require.Equal(t, int64(3), row.SuccessCount)
	require.Equal(t, int64(1000), row.TotalLatencyMs)
	require.Equal(t, int64(140), row.TtftSumMs)
	require.Equal(t, int64(3), row.TtftCount)
	require.Equal(t, int64(350), row.OutputTokens)
	require.Equal(t, int64(1200), row.GenerationMs)
}

func TestPerfMetricExistingColumnQualifiesPostgreSQLUpsertColumns(t *testing.T) {
	oldMainDatabaseType := common.MainDatabaseType()
	t.Cleanup(func() {
		common.SetMainDatabaseType(oldMainDatabaseType)
	})

	common.SetMainDatabaseType(common.DatabaseTypePostgreSQL)
	require.Equal(t, `"perf_metrics"."generation_ms"`, perfMetricExistingColumn("generation_ms"))

	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	require.Equal(t, "generation_ms", perfMetricExistingColumn("generation_ms"))
}
