import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveLogTimeRange } from '../src/features/usage-logs/lib/time-range.ts'

test('default and reset follow the local day across midnight', () => {
  const now = new Date(2026, 8, 6, 23, 59, 59)
  const next = new Date(2026, 8, 7, 0, 0, 5)
  const today = resolveLogTimeRange({}, now)
  assert.equal(today.start?.getTime(), new Date(2026, 8, 6).getTime())
  assert.equal(today.end?.getTime(), now.getTime())
  const reset = resolveLogTimeRange(
    { timeMode: 'today', startTime: 1, endTime: 2 },
    next
  )
  assert.equal(reset.start?.getTime(), new Date(2026, 8, 7).getTime())
  assert.equal(reset.end?.getTime(), next.getTime())
})

test('recent windows roll forward without changing the selected duration', () => {
  const now = new Date(2026, 8, 6, 10)
  for (const [recentMinutes, recentUnit] of [
    [30, 'minute'],
    [6, 'hour'],
    [2, 'day'],
  ] as const) {
    for (const offset of [0, 5000, 90000]) {
      const refreshedAt = new Date(now.getTime() + offset)
      const range = resolveLogTimeRange(
        { timeMode: 'recent', recentMinutes, recentUnit },
        refreshedAt
      )
      assert.equal(range.timeMode, 'recent')
      assert.equal(range.recentMinutes, recentMinutes)
      assert.equal(range.recentUnit, recentUnit)
      assert.equal(range.end?.getTime(), refreshedAt.getTime())
      assert.equal(
        range.start?.getTime(),
        refreshedAt.getTime() - recentMinutes * 60000
      )
    }
  }
})

test('custom and legacy absolute ranges remain fixed on refresh', () => {
  const selection = { startTime: 1700000000000, endTime: 1700000300000 }
  for (const timeMode of [undefined, 'fixed']) {
    for (const now of [new Date(2026, 8, 6), new Date(2026, 8, 7)]) {
      const range = resolveLogTimeRange({ ...selection, timeMode }, now)
      assert.equal(range.timeMode, 'fixed')
      assert.equal(range.start?.getTime(), selection.startTime)
      assert.equal(range.end?.getTime(), selection.endTime)
    }
  }
  const openEnded = resolveLogTimeRange({ timeMode: 'fixed', startTime: 0 })
  assert.equal(openEnded.start?.getTime(), 0)
  assert.equal(openEnded.end, undefined)
})

test('pinned timestamps do not trap a recent refresh into fixed mode', () => {
  // Auto-refresh writes the resolved range back into the URL; the explicit
  // timeMode must keep winning over those now-stale timestamps.
  const now = new Date(2026, 8, 6, 10)
  const pinned = { startTime: 1700000000000, endTime: 1700000300000 }
  const recent = resolveLogTimeRange(
    { ...pinned, timeMode: 'recent', recentMinutes: 30, recentUnit: 'minute' },
    now
  )
  assert.equal(recent.timeMode, 'recent')
  assert.equal(recent.end?.getTime(), now.getTime())
  assert.equal(recent.start?.getTime(), now.getTime() - 30 * 60000)
})

test('invalid recent values use the supported one-hour default', () => {
  for (const recentMinutes of [undefined, 0, -5, 1.5, Number.NaN, 43201]) {
    assert.equal(
      resolveLogTimeRange({ timeMode: 'recent', recentMinutes }).recentMinutes,
      60
    )
  }
  // Legacy links carrying recentHours still resolve, capped at 24 hours.
  assert.equal(
    resolveLogTimeRange({ timeMode: 'recent', recentHours: 24 }).recentMinutes,
    1440
  )
  assert.equal(
    resolveLogTimeRange({ timeMode: 'recent', recentHours: 25 }).recentMinutes,
    60
  )
})
