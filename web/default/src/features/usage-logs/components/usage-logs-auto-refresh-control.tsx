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
import { RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { useUsageLogsContext } from './usage-logs-provider'

const AUTO_REFRESH_OPTIONS = [0, 5, 10, 30, 60] as const

function formatAutoRefreshLabel(seconds: number, disabledLabel: string) {
  return seconds > 0 ? `${seconds}s` : disabledLabel
}

export function UsageLogsAutoRefreshControl() {
  const { t } = useTranslation()
  const { autoRefreshSeconds, setAutoRefreshSeconds } = useUsageLogsContext()
  const disabledLabel = t('Disabled')
  const options = useMemo(
    () =>
      AUTO_REFRESH_OPTIONS.map((seconds) => ({
        value: String(seconds),
        label: formatAutoRefreshLabel(seconds, disabledLabel),
      })),
    [disabledLabel]
  )
  const selectedLabel = formatAutoRefreshLabel(
    autoRefreshSeconds,
    disabledLabel
  )

  return (
    <Tooltip>
      <TooltipTrigger render={<div className='flex items-center gap-1' />}>
        <RefreshCw
          className={
            autoRefreshSeconds > 0
              ? 'text-primary size-3.5'
              : 'text-muted-foreground size-3.5'
          }
          aria-hidden='true'
        />
        <Select
          items={options}
          value={String(autoRefreshSeconds)}
          onValueChange={(value) => setAutoRefreshSeconds(Number(value))}
        >
          <SelectTrigger
            size='sm'
            aria-label={t('Auto refresh')}
            className='h-7 w-[76px] rounded-md px-2 text-xs'
          >
            <SelectValue>{selectedLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            <SelectGroup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </TooltipTrigger>
      <TooltipContent>{t('Auto refresh')}</TooltipContent>
    </Tooltip>
  )
}
