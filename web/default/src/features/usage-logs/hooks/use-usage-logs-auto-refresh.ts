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
import { useEffect, useEffectEvent } from 'react'

export function useUsageLogsAutoRefresh(
  autoRefreshSeconds: number,
  refresh: () => Promise<unknown>,
  isAutoRefreshingRef: { current: boolean }
) {
  const onRefresh = useEffectEvent(refresh)
  useEffect(() => {
    if (autoRefreshSeconds <= 0) {
      return
    }

    let stopped = false
    let timer: number
    const tick = async () => {
      if (
        document.visibilityState !== 'hidden' &&
        !isAutoRefreshingRef.current
      ) {
        isAutoRefreshingRef.current = true
        try {
          await onRefresh()
        } catch {
          // The next refresh can recover without discarding the displayed data.
        } finally {
          isAutoRefreshingRef.current = false
        }
      }
      if (!stopped) timer = window.setTimeout(tick, autoRefreshSeconds * 1000)
    }
    timer = window.setTimeout(tick, autoRefreshSeconds * 1000)
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [autoRefreshSeconds, isAutoRefreshingRef])
}
