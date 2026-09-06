export type LogTimeMode = 'today' | 'recent' | 'fixed'

export interface LogTimeRange {
  timeMode: LogTimeMode
  recentHours?: number
  start?: Date
  end?: Date
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
    const hours = Number(search.recentHours)
    const recentHours =
      Number.isInteger(hours) && hours >= 1 && hours <= 24 ? hours : 1
    return {
      timeMode,
      recentHours,
      start: new Date(now.getTime() - recentHours * 3600000),
      end: now,
    }
  }
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return { timeMode, start, end: now }
}
