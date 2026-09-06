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

test('recent hours roll forward without changing the selected duration', () => {
  const now = new Date(2026, 8, 6, 10)
  for (const recentHours of [1, 6, 24]) {
    const selection = { timeMode: 'recent', recentHours }
    for (const offset of [0, 5000, 90000]) {
      const refreshedAt = new Date(now.getTime() + offset)
      const range = resolveLogTimeRange(selection, refreshedAt)
      assert.equal(range.recentHours, recentHours)
      assert.equal(range.end?.getTime(), refreshedAt.getTime())
      assert.equal(
        range.start?.getTime(),
        refreshedAt.getTime() - recentHours * 3600000
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

test('invalid recent hours use the supported one-hour default', () => {
  for (const recentHours of [undefined, 0, 25, -1, 1.5, Number.NaN]) {
    assert.equal(
      resolveLogTimeRange({ timeMode: 'recent', recentHours }).recentHours,
      1
    )
  }
})
