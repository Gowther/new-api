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
import { isAxiosError } from 'axios'
import { t } from 'i18next'
import { toast } from 'sonner'

import { api } from '@/lib/api'

import { buildQueryParams } from './lib/query-params'
import type {
  GetLogsParams,
  GetLogsResponse,
  GetLogStatsParams,
  GetLogStatsResponse,
  GetMidjourneyLogsParams,
  GetTaskLogsParams,
  UserInfo,
} from './types'

// ============================================================================
// Generic API Helpers
// ============================================================================

async function requestLogData<T>(
  url: string,
  silent: boolean,
  signal?: AbortSignal
): Promise<T> {
  try {
    const response = await api.get<T>(url, {
      timeout: 15000,
      signal,
      disableDuplicate: true,
      skipBusinessError: silent,
      skipErrorHandler: true,
    })
    return response.data
  } catch (error) {
    if (!silent && !signal?.aborted) {
      const message = isAxiosError(error)
        ? error.response?.data?.message || error.message
        : t('Request failed')
      toast.error(message)
    }
    throw error
  }
}

function buildApiPath(endpoint: string, isAdmin: boolean): string {
  return isAdmin ? endpoint : `${endpoint}/self`
}

async function fetchLogs<T>(
  endpoint: string,
  params: T,
  isAdmin: boolean,
  suppressErrorToast = false,
  signal?: AbortSignal
): Promise<GetLogsResponse> {
  const paramRecord = params as unknown as Record<string, unknown>
  const queryParams = buildQueryParams({
    p: paramRecord.p || 1,
    page_size: paramRecord.page_size || 20,
    ...params,
  })
  const path = buildApiPath(endpoint, isAdmin)
  return requestLogData<GetLogsResponse>(
    `${path}?${queryParams}`,
    suppressErrorToast,
    signal
  )
}

async function fetchLogStats<T>(
  endpoint: string,
  params: T,
  isAdmin: boolean,
  suppressErrorToast = false,
  signal?: AbortSignal
): Promise<GetLogStatsResponse> {
  const queryParams = buildQueryParams(
    params as unknown as Record<string, unknown>
  )
  const path = buildApiPath(endpoint, isAdmin)
  return requestLogData<GetLogStatsResponse>(
    `${path}/stat?${queryParams}`,
    suppressErrorToast,
    signal
  )
}

// ============================================================================
// Common Log APIs
// ============================================================================

export const getAllLogs = (
  params: GetLogsParams = {},
  suppressErrorToast = false,
  signal?: AbortSignal
) => fetchLogs('/api/log', params, true, suppressErrorToast, signal)

export const getUserLogs = (
  params: Omit<GetLogsParams, 'username' | 'channel'> = {},
  suppressErrorToast = false,
  signal?: AbortSignal
) => fetchLogs('/api/log', params, false, suppressErrorToast, signal)

export const getLogStats = (
  params: GetLogStatsParams = {},
  suppressErrorToast = false,
  signal?: AbortSignal
) => fetchLogStats('/api/log', params, true, suppressErrorToast, signal)

export const getUserLogStats = (
  params: Omit<GetLogStatsParams, 'username' | 'channel'> = {},
  suppressErrorToast = false,
  signal?: AbortSignal
) => fetchLogStats('/api/log', params, false, suppressErrorToast, signal)

export async function getUserInfo(
  userId: number
): Promise<{ success: boolean; message?: string; data?: UserInfo }> {
  const res = await api.get(`/api/user/${userId}`)
  return res.data
}

// ============================================================================
// MjProxy (Drawing) Logs API
// ============================================================================

export const getAllMidjourneyLogs = (
  params: GetMidjourneyLogsParams,
  suppressErrorToast = false,
  signal?: AbortSignal
) => fetchLogs('/api/mj', params, true, suppressErrorToast, signal)

export const getUserMidjourneyLogs = (
  params: GetMidjourneyLogsParams,
  suppressErrorToast = false,
  signal?: AbortSignal
) => fetchLogs('/api/mj', params, false, suppressErrorToast, signal)

// ============================================================================
// Task Logs API
// ============================================================================

export const getAllTaskLogs = (
  params: GetTaskLogsParams,
  suppressErrorToast = false,
  signal?: AbortSignal
) => fetchLogs('/api/task', params, true, suppressErrorToast, signal)

export const getUserTaskLogs = (
  params: GetTaskLogsParams,
  suppressErrorToast = false,
  signal?: AbortSignal
) => fetchLogs('/api/task', params, false, suppressErrorToast, signal)
