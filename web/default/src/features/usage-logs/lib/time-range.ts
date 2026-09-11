export type LogTimeMode = 'today' | 'recent' | 'fixed'

export interface LogTimeRange {
  timeMode: LogTimeMode
  recentMinutes?: number
  start?: Date
  end?: Date
}

// The recent window is stored in minutes so sub-hour ranges are possible.
// Links written before the change carry recentHours; they still resolve,
// multiplied into minutes. Free-form input is capped at 30 days — wider
// windows belong to the fixed range mode.
export const RECENT_MINUTES_MIN = 1
export const RECENT_MINUTES_MAX = 30 * 24 * 60
const LEGACY_RECENT_HOURS_MAX = 24
const RECENT_MINUTES_DEFAULT = 60

export function normalizeRecentMinutes(search: {
  recentMinutes?: unknown
  recentHours?: unknown
}): number {
  const minutes = Number(search.recentMinutes)
  if (
    Number.isInteger(minutes) &&
    minutes >= RECENT_MINUTES_MIN &&
    minutes <= RECENT_MINUTES_MAX
  ) {
    return minutes
  }
  const legacyHours = Number(search.recentHours)
  if (
    Number.isInteger(legacyHours) &&
    legacyHours >= 1 &&
    legacyHours <= LEGACY_RECENT_HOURS_MAX
  ) {
    return legacyHours * 60
  }
  return RECENT_MINUTES_DEFAULT
}

export function resolveLogTimeRange(
  search: Record<string, unknown>,
  now = new Date()
): LogTimeRange {
  let timeMode: LogTimeMode =
    search.startTime != null || search.endTime != null ? 'fixed' : 'today'
  if (
    search.timeMode === 'today' ||
    search.timeMode === 'recent' ||
    search.timeMode === 'fixed'
  ) {
    timeMode = search.timeMode
  }
  if (timeMode === 'fixed') {
    return {
      timeMode,
      start:
        typeof search.startTime === 'number'
          ? new Date(search.startTime)
          : undefined,
      end:
        typeof search.endTime === 'number'
          ? new Date(search.endTime)
          : undefined,
    }
  }
  if (timeMode === 'recent') {
    const recentMinutes = normalizeRecentMinutes(search)
    return {
      timeMode,
      recentMinutes,
      start: new Date(now.getTime() - recentMinutes * 60000),
      end: now,
    }
  }
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return { timeMode, start, end: now }
}
