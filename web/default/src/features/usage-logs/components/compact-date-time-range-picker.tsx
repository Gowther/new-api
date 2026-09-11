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
import { CalendarDays } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import dayjs from '@/lib/dayjs'
import { cn } from '@/lib/utils'

import {
  RECENT_MINUTES_MAX,
  RECENT_MINUTES_MIN,
  resolveLogTimeRange,
  type LogTimeMode,
  type LogTimeRange,
} from '../lib/time-range'

interface CompactDateTimeRangePickerProps {
  start?: Date
  end?: Date
  timeMode?: LogTimeMode
  recentMinutes?: number
  onChange: (range: LogTimeRange) => void
  className?: string
}

function toInputValue(date?: Date): string {
  return date ? dayjs(date).format('YYYY-MM-DDTHH:mm') : ''
}

function fromInputValue(value: string): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

type RecentUnit = 'minute' | 'hour' | 'day'

const RECENT_UNIT_MINUTES: Record<RecentUnit, number> = {
  minute: 1,
  hour: 60,
  day: 1440,
}

const RECENT_UNIT_LABEL_KEYS: Record<RecentUnit, string> = {
  minute: 'Minutes',
  hour: 'Hours',
  day: 'Days',
}

/** Split a minute count into the largest whole unit for display. */
function splitRecentMinutes(minutes: number): { amount: number; unit: RecentUnit } {
  if (minutes % 1440 === 0) return { amount: minutes / 1440, unit: 'day' }
  if (minutes % 60 === 0) return { amount: minutes / 60, unit: 'hour' }
  return { amount: minutes, unit: 'minute' }
}

export function CompactDateTimeRangePicker({
  start,
  end,
  timeMode = 'fixed',
  recentMinutes = 60,
  onChange,
  className,
}: CompactDateTimeRangePickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draftStart, setDraftStart] = useState(toInputValue(start))
  const [draftEnd, setDraftEnd] = useState(toInputValue(end))
  // The recent row is a draft like the datetime inputs: it only applies on
  // confirm, and only when the operator actually touched it this session.
  const [recentAmountDraft, setRecentAmountDraft] = useState('1')
  const [recentUnitDraft, setRecentUnitDraft] = useState<RecentUnit>('hour')
  const [recentTouched, setRecentTouched] = useState(false)

  const recentDraftMinutes = useMemo(() => {
    const amount = Math.floor(Number(recentAmountDraft))
    if (!Number.isInteger(amount) || String(amount) !== recentAmountDraft.trim()) {
      return null
    }
    const minutes = amount * RECENT_UNIT_MINUTES[recentUnitDraft]
    if (minutes < RECENT_MINUTES_MIN || minutes > RECENT_MINUTES_MAX) {
      return null
    }
    return minutes
  }, [recentAmountDraft, recentUnitDraft])

  const label = useMemo(() => {
    if (timeMode === 'today') return t('Today')
    if (timeMode === 'recent') {
      const { amount, unit } = splitRecentMinutes(recentMinutes)
      if (unit === 'day') {
        return amount === 1 ? t('Last day') : t('Last {{days}} days', { days: amount })
      }
      if (unit === 'hour') {
        return amount === 1
          ? t('Last hour')
          : t('Last {{hours}} hours', { hours: amount })
      }
      return amount === 1
        ? t('Last minute')
        : t('Last {{minutes}} minutes', { minutes: amount })
    }
    if (!start && !end) return t('Date Range')
    // The popover's <input type="datetime-local"> only supports minute
    // precision, so seconds are always 00 (manual pick) or 59 (preset
    // end-of-day). Hide them in the trigger label to keep the button
    // width compact while still showing the meaningful timestamp.
    const startText = start ? dayjs(start).format('YYYY-MM-DD HH:mm') : '-'
    const endText = end ? dayjs(end).format('YYYY-MM-DD HH:mm') : '-'
    return `${startText} ~ ${endText}`
  }, [end, start, t, timeMode, recentMinutes])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      const range = resolveLogTimeRange({
        timeMode,
        recentMinutes,
        startTime: start?.getTime(),
        endTime: end?.getTime(),
      })
      setDraftStart(toInputValue(range.start))
      setDraftEnd(toInputValue(range.end))
      const recent = splitRecentMinutes(recentMinutes)
      setRecentAmountDraft(String(recent.amount))
      setRecentUnitDraft(recent.unit)
      setRecentTouched(false)
    }
    setOpen(nextOpen)
  }

  const applyDraft = () => {
    // A touched recent row wins over the datetime inputs: both describe the
    // window, and the one the operator just edited is the intent.
    if (recentTouched && recentDraftMinutes !== null) {
      onChange(
        resolveLogTimeRange({
          timeMode: 'recent',
          recentMinutes: recentDraftMinutes,
        })
      )
      setOpen(false)
      return
    }
    onChange({
      timeMode: draftStart || draftEnd ? 'fixed' : 'today',
      start: fromInputValue(draftStart),
      end: fromInputValue(draftEnd),
    })
    setOpen(false)
  }

  const applyPreset = (
    kind: 'yesterday' | 'today' | '7d' | 'week' | '30d' | 'month'
  ) => {
    const now = dayjs()
    const presets = {
      yesterday: {
        start: now.subtract(1, 'day').startOf('day').toDate(),
        end: now.subtract(1, 'day').endOf('day').toDate(),
      },
      today: {
        start: now.startOf('day').toDate(),
        end: now.toDate(),
      },
      '7d': {
        start: now.subtract(6, 'day').startOf('day').toDate(),
        end: now.endOf('day').toDate(),
      },
      week: {
        start: now.startOf('week').toDate(),
        end: now.endOf('week').toDate(),
      },
      '30d': {
        start: now.subtract(29, 'day').startOf('day').toDate(),
        end: now.endOf('day').toDate(),
      },
      month: {
        start: now.startOf('month').toDate(),
        end: now.endOf('month').toDate(),
      },
    }
    const range = presets[kind]
    setDraftStart(toInputValue(range.start))
    setDraftEnd(toInputValue(range.end))
    onChange({ ...range, timeMode: kind === 'today' ? 'today' : 'fixed' })
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            className={cn(
              'w-full justify-start gap-2 px-2.5 text-sm leading-5 font-normal tabular-nums',
              !start && !end && 'text-muted-foreground',
              className
            )}
          />
        }
      >
        <CalendarDays className='text-muted-foreground size-4 shrink-0' />
        <span className='truncate'>{label}</span>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-[min(520px,calc(100vw-2rem))] p-3'
      >
        <div className='space-y-3'>
          <div className='grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-end'>
            <div className='space-y-1.5'>
              <div className='text-muted-foreground text-xs'>
                {t('Start Time')}
              </div>
              <Input
                type='datetime-local'
                aria-label={t('Start Time')}
                value={draftStart}
                onChange={(e) => setDraftStart(e.target.value)}
                className='h-8 text-sm leading-5 tabular-nums'
              />
            </div>
            <span className='text-muted-foreground hidden pb-2 text-xs sm:block'>
              ~
            </span>
            <div className='space-y-1.5'>
              <div className='text-muted-foreground text-xs'>
                {t('End Time')}
              </div>
              <Input
                type='datetime-local'
                aria-label={t('End Time')}
                value={draftEnd}
                onChange={(e) => setDraftEnd(e.target.value)}
                className='h-8 text-sm leading-5 tabular-nums'
              />
            </div>
          </div>

          <div className='space-y-1.5'>
            <div className='text-muted-foreground text-xs'>{t('Recent')}</div>
            <div className='flex gap-2'>
              <Input
                type='number'
                min={1}
                step={1}
                aria-label={t('Recent amount')}
                value={recentAmountDraft}
                onChange={(e) => {
                  setRecentAmountDraft(e.target.value)
                  setRecentTouched(true)
                }}
                className={cn(
                  'h-8 flex-1 text-sm leading-5 tabular-nums',
                  recentTouched &&
                    recentDraftMinutes === null &&
                    'border-destructive'
                )}
              />
              <Select
                items={(
                  ['minute', 'hour', 'day'] as const
                ).map((unit) => ({
                  value: unit,
                  label: t(RECENT_UNIT_LABEL_KEYS[unit]),
                }))}
                value={recentUnitDraft}
                onValueChange={(value) => {
                  if (value === 'minute' || value === 'hour' || value === 'day') {
                    setRecentUnitDraft(value)
                    setRecentTouched(true)
                  }
                }}
              >
                <SelectTrigger className='w-28' aria-label={t('Recent unit')}>
                  <SelectValue>
                    {t(RECENT_UNIT_LABEL_KEYS[recentUnitDraft])}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {(['minute', 'hour', 'day'] as const).map((unit) => (
                      <SelectItem key={unit} value={unit}>
                        {t(RECENT_UNIT_LABEL_KEYS[unit])}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className='flex flex-wrap gap-1.5'>
            <Button
              type='button'
              variant='secondary'
              size='sm'
              className='h-7 flex-1 px-2 text-xs'
              onClick={() => applyPreset('yesterday')}
            >
              {t('Yesterday')}
            </Button>
            <Button
              type='button'
              variant='secondary'
              size='sm'
              className='h-7 flex-1 px-2 text-xs'
              onClick={() => applyPreset('today')}
            >
              {t('Today')}
            </Button>
            <Button
              type='button'
              variant='secondary'
              size='sm'
              className='h-7 flex-1 px-2 text-xs'
              onClick={() => applyPreset('7d')}
            >
              {t('7 Days')}
            </Button>
            <Button
              type='button'
              variant='secondary'
              size='sm'
              className='h-7 flex-1 px-2 text-xs'
              onClick={() => applyPreset('week')}
            >
              {t('This week')}
            </Button>
            <Button
              type='button'
              variant='secondary'
              size='sm'
              className='h-7 flex-1 px-2 text-xs'
              onClick={() => applyPreset('30d')}
            >
              {t('30 Days')}
            </Button>
            <Button
              type='button'
              variant='secondary'
              size='sm'
              className='h-7 flex-1 px-2 text-xs'
              onClick={() => applyPreset('month')}
            >
              {t('This month')}
            </Button>
          </div>

          <div className='flex justify-end'>
            <Button
              size='sm'
              className='h-8'
              onClick={applyDraft}
              disabled={
                Boolean(draftStart && draftEnd && draftStart > draftEnd) ||
                (recentTouched && recentDraftMinutes === null)
              }
            >
              {t('Confirm')}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
