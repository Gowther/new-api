/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type {
  ErrorSummaryItem,
  ErrorSummaryResponse,
  ErrorWorkbenchFilters,
} from './types'

export const DEFAULT_FILTERS: ErrorWorkbenchFilters = {
  timeRange: '24',
  limit: 50,
  modelName: '',
  channel: '',
  group: '',
}

export const EMPTY_SUMMARY: ErrorSummaryResponse = {
  items: [],
  scanned_logs: 0,
  total_logs: 0,
  truncated: false,
  start_time: 0,
  end_time: 0,
}

export function buildTimeRangeParams(
  timeRange: string,
): Record<string, number> {
  if (timeRange === 'today' || timeRange === 'yesterday') {
    const now = new Date()
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    )
    const todayStartSeconds = Math.floor(todayStart.getTime() / 1000)
    if (timeRange === 'today') {
      return {
        start_time: todayStartSeconds,
        end_time: Math.floor(now.getTime() / 1000),
      }
    }
    return {
      start_time: todayStartSeconds - 24 * 3600,
      end_time: todayStartSeconds - 1,
    }
  }
  return { hours: Number(timeRange) || Number(DEFAULT_FILTERS.timeRange) }
}

export function buildSummaryParams(filters: ErrorWorkbenchFilters) {
  const params: Record<string, number | string> = {
    limit: filters.limit,
    ...buildTimeRangeParams(filters.timeRange),
  }
  if (filters.modelName.trim()) {
    params.model_name = filters.modelName.trim()
  }
  if (filters.channel.trim()) {
    params.channel = Number(filters.channel)
  }
  if (filters.group.trim()) {
    params.group = filters.group.trim()
  }
  return params
}

export function formatErrorRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '0%'
  if (rate >= 1) return '100%'
  return `${(rate * 100).toFixed(rate < 0.01 ? 1 : 0)}%`
}

export function getVisibleAffectedRequests(items: ErrorSummaryItem[]): number {
  return items.reduce((total, item) => total + item.affected_requests, 0)
}

export function getUrgentClusterCount(items: ErrorSummaryItem[]): number {
  return items.filter(
    (item) => item.severity === 'critical' || item.severity === 'high',
  ).length
}
