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
import { SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

import { DEFAULT_FILTERS } from '../lib'
import type { ErrorWorkbenchFilters } from '../types'
import { ErrorMetricHelp } from './error-metric-help'

type ErrorWorkbenchFiltersPopoverProps = {
  filters: ErrorWorkbenchFilters
  onChange: (key: keyof ErrorWorkbenchFilters, value: string | number) => void
  onReset: () => void
}

/**
 * Everything except the time range, which stays on the toolbar because it is
 * the one filter an operator changes while reading. The rest narrow a single
 * investigation, so they live behind a trigger that reports how many are
 * active rather than occupying a permanent row.
 */
export function ErrorWorkbenchFiltersPopover(
  props: ErrorWorkbenchFiltersPopoverProps
) {
  const { t } = useTranslation()
  const activeCount = [
    props.filters.modelName.trim() !== '',
    props.filters.channel.trim() !== '',
    props.filters.group.trim() !== '',
    props.filters.limit !== DEFAULT_FILTERS.limit,
  ].filter(Boolean).length

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button type='button' variant='outline'>
            <SlidersHorizontal className='size-4' />
            {t('Filters')}
            {activeCount > 0 && (
              <Badge variant='secondary' className='ml-1 tabular-nums'>
                {activeCount}
              </Badge>
            )}
          </Button>
        }
      />
      <PopoverContent align='end' className='w-80 space-y-3'>
        <div className='space-y-1.5'>
          <Label htmlFor='error-workbench-model'>{t('Model')}</Label>
          <Input
            id='error-workbench-model'
            value={props.filters.modelName}
            placeholder='gpt-4o'
            onChange={(event) =>
              props.onChange('modelName', event.target.value)
            }
          />
        </div>
        <div className='grid grid-cols-2 gap-3'>
          <div className='space-y-1.5'>
            <Label htmlFor='error-workbench-channel'>{t('Channel ID')}</Label>
            <Input
              id='error-workbench-channel'
              type='number'
              min={1}
              value={props.filters.channel}
              onChange={(event) =>
                props.onChange('channel', event.target.value)
              }
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='error-workbench-group'>{t('Group')}</Label>
            <Input
              id='error-workbench-group'
              value={props.filters.group}
              placeholder='default'
              onChange={(event) =>
                props.onChange('group', event.target.value)
              }
            />
          </div>
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='error-workbench-limit'>
            <ErrorMetricHelp
              description={t(
                'Limit controls how many fault clusters are returned after severity ranking. It does not limit the route attempts used to calculate each route error rate.'
              )}
            >
              {t('Fault cluster limit')}
            </ErrorMetricHelp>
          </Label>
          <Input
            id='error-workbench-limit'
            type='number'
            min={1}
            max={200}
            value={props.filters.limit}
            onChange={(event) =>
              props.onChange('limit', Number(event.target.value) || 50)
            }
          />
        </div>
        <Button
          type='button'
          variant='outline'
          className='w-full'
          onClick={props.onReset}
        >
          {t('Reset')}
        </Button>
      </PopoverContent>
    </Popover>
  )
}

type ErrorWorkbenchTimeRangeProps = {
  value: string
  onChange: (value: string) => void
}

export function ErrorWorkbenchTimeRange(props: ErrorWorkbenchTimeRangeProps) {
  const { t } = useTranslation()

  return (
    <NativeSelect
      id='error-workbench-hours'
      aria-label={t('Time range')}
      className='w-auto'
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    >
      <NativeSelectOption value='today'>{t('Today')}</NativeSelectOption>
      <NativeSelectOption value='yesterday'>
        {t('Yesterday')}
      </NativeSelectOption>
      <NativeSelectOption value='1'>{t('Last 1 hour')}</NativeSelectOption>
      <NativeSelectOption value='6'>{t('Last 6 hours')}</NativeSelectOption>
      <NativeSelectOption value='24'>{t('Last 24 hours')}</NativeSelectOption>
      <NativeSelectOption value='72'>{t('Last 3 days')}</NativeSelectOption>
      <NativeSelectOption value='168'>{t('Last 7 days')}</NativeSelectOption>
    </NativeSelect>
  )
}
