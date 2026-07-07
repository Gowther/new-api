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
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, type ReactNode } from 'react'

import type { ChannelAffinityInfo } from '../types'

const AUTO_REFRESH_STORAGE_KEY = 'usage-logs:auto-refresh-seconds'
const AUTO_REFRESH_INTERVALS = [0, 5, 10, 30, 60] as const

function getInitialAutoRefreshSeconds(): number {
  try {
    const stored = Number(localStorage.getItem(AUTO_REFRESH_STORAGE_KEY))
    return AUTO_REFRESH_INTERVALS.includes(
      stored as (typeof AUTO_REFRESH_INTERVALS)[number]
    )
      ? stored
      : 0
  } catch {
    return 0
  }
}

interface UsageLogsContextValue {
  selectedUserId: number | null
  setSelectedUserId: (userId: number | null) => void
  userInfoDialogOpen: boolean
  setUserInfoDialogOpen: (open: boolean) => void
  affinityTarget: ChannelAffinityInfo | null
  setAffinityTarget: (target: ChannelAffinityInfo | null) => void
  affinityDialogOpen: boolean
  setAffinityDialogOpen: (open: boolean) => void
  sensitiveVisible: boolean
  setSensitiveVisible: (visible: boolean) => void
  autoRefreshSeconds: number
  setAutoRefreshSeconds: (seconds: number) => void
}

const UsageLogsContext = createContext<UsageLogsContextValue | undefined>(
  undefined
)

export function UsageLogsProvider({ children }: { children: ReactNode }) {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [userInfoDialogOpen, setUserInfoDialogOpen] = useState(false)
  const [affinityTarget, setAffinityTarget] =
    useState<ChannelAffinityInfo | null>(null)
  const [affinityDialogOpen, setAffinityDialogOpen] = useState(false)
  const [sensitiveVisible, setSensitiveVisible] = useState(true)
  const [autoRefreshSeconds, setAutoRefreshSecondsState] = useState(
    getInitialAutoRefreshSeconds
  )

  const setAutoRefreshSeconds = (seconds: number) => {
    const next = AUTO_REFRESH_INTERVALS.includes(
      seconds as (typeof AUTO_REFRESH_INTERVALS)[number]
    )
      ? seconds
      : 0
    setAutoRefreshSecondsState(next)
    try {
      localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(next))
    } catch {
      /* ignore storage failures */
    }
  }

  return (
    <UsageLogsContext.Provider
      value={{
        selectedUserId,
        setSelectedUserId,
        userInfoDialogOpen,
        setUserInfoDialogOpen,
        affinityTarget,
        setAffinityTarget,
        affinityDialogOpen,
        setAffinityDialogOpen,
        sensitiveVisible,
        setSensitiveVisible,
        autoRefreshSeconds,
        setAutoRefreshSeconds,
      }}
    >
      {children}
    </UsageLogsContext.Provider>
  )
}

export function useUsageLogsContext() {
  const context = useContext(UsageLogsContext)
  if (!context) {
    throw new Error('useUsageLogsContext must be used within UsageLogsProvider')
  }
  return context
}
