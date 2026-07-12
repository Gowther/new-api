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
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Activity, ExternalLink, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { api } from '@/lib/api'
import { formatTimestampToDate } from '@/lib/format'
import { useDebounce } from '@/hooks'
import { testChannel as testChannelRequest } from '@/features/channels/api'

import { ErrorClusterDetails } from './components/error-cluster-details'
import { ErrorClusterList } from './components/error-cluster-list'
import {
  DEFAULT_FILTERS,
  EMPTY_SUMMARY,
  buildSummaryParams,
  getUrgentClusterCount,
  getVisibleAffectedRequests,
} from './lib'
import type { ErrorSummaryResponse, ErrorWorkbenchFilters } from './types'

type BackendResponse<T> = {
  success: boolean
  message?: string
  data?: T
}

const FILTER_INPUT_DEBOUNCE_MS = 500

async function getErrorSummary(filters: ErrorWorkbenchFilters) {
  const response = await api.get<BackendResponse<ErrorSummaryResponse>>(
    '/api/log/error_summary',
    {
      params: buildSummaryParams(filters),
      disableDuplicate: true,
    },
  )
  if (!response.data.success) {
    throw new Error(response.data.message || 'Failed to load error summary')
  }
  return response.data.data ?? EMPTY_SUMMARY
}

export function ErrorWorkbench() {
  const { t } = useTranslation()
  const [filters, setFilters] = useState<ErrorWorkbenchFilters>(DEFAULT_FILTERS)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [testingChannelId, setTestingChannelId] = useState<number | null>(null)

  const debouncedLimit = useDebounce(filters.limit, FILTER_INPUT_DEBOUNCE_MS)
  const debouncedModelName = useDebounce(
    filters.modelName,
    FILTER_INPUT_DEBOUNCE_MS,
  )
  const debouncedChannel = useDebounce(
    filters.channel,
    FILTER_INPUT_DEBOUNCE_MS,
  )
  const debouncedGroup = useDebounce(filters.group, FILTER_INPUT_DEBOUNCE_MS)

  const queryFilters: ErrorWorkbenchFilters = {
    timeRange: filters.timeRange,
    limit: debouncedLimit,
    modelName: debouncedModelName,
    channel: debouncedChannel,
    group: debouncedGroup,
  }

  const summaryQuery = useQuery({
    queryKey: ['error-workbench-summary', queryFilters],
    queryFn: () => getErrorSummary(queryFilters),
  })
  const summary = summaryQuery.data ?? EMPTY_SUMMARY
  const selectedRecord =
    summary.items.find((item) => item.key === selectedKey) ??
    summary.items[0] ??
    null

  const testMutation = useMutation({
    mutationFn: async (input: { channelId: number; modelName: string }) => {
      const response = await testChannelRequest(
        input.channelId,
        input.modelName ? { model: input.modelName } : undefined,
      )
      if (!response.success) {
        throw new Error(response.message || t('Channel test failed'))
      }
      return response
    },
    onMutate: (input) => {
      setTestingChannelId(input.channelId)
    },
    onSuccess: () => {
      toast.success(t('Channel test succeeded'))
      void summaryQuery.refetch()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t('Channel test failed'),
      )
    },
    onSettled: () => {
      setTestingChannelId(null)
    },
  })

  const setFilterValue = (
    key: keyof ErrorWorkbenchFilters,
    value: string | number,
  ) => {
    setFilters((previous) => ({ ...previous, [key]: value }))
  }

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS)
    setSelectedKey(null)
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        <span className='flex min-w-0 items-center gap-2'>
          <span className='truncate'>{t('Error Workbench')}</span>
          <Badge variant='outline' className='shrink-0'>
            Admin
          </Badge>
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          type='button'
          variant='outline'
          render={
            <Link to='/usage-logs/$section' params={{ section: 'common' }} />
          }
        >
          <ExternalLink className='size-4' />
          {t('Open usage logs')}
        </Button>
        <Button
          type='button'
          variant='outline'
          render={
            <Link to='/models/$section' params={{ section: 'routing' }} />
          }
        >
          <Activity className='size-4' />
          {t('Open model routing')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex min-h-0 flex-col gap-4'>
          <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
            <div className='rounded-lg border px-4 py-3'>
              <div className='text-muted-foreground text-xs'>
                {t('Error logs')}
              </div>
              <div className='mt-1 text-2xl font-semibold tabular-nums'>
                {summary.total_logs.toLocaleString()}
              </div>
              <div className='text-muted-foreground mt-1 text-xs'>
                {summary.truncated
                  ? t('Only the latest scanned logs are summarized')
                  : t('All matching logs are summarized')}
              </div>
            </div>
            <div className='rounded-lg border px-4 py-3'>
              <div className='text-muted-foreground text-xs'>
                {t('Fault clusters')}
              </div>
              <div className='mt-1 text-2xl font-semibold tabular-nums'>
                {summary.items.length.toLocaleString()}
              </div>
              <div className='text-muted-foreground mt-1 text-xs'>
                {t('Visible clusters')}
              </div>
            </div>
            <div className='rounded-lg border px-4 py-3'>
              <div className='text-muted-foreground text-xs'>
                {t('Affected requests')}
              </div>
              <div className='mt-1 text-2xl font-semibold tabular-nums'>
                {getVisibleAffectedRequests(summary.items).toLocaleString()}
              </div>
              <div className='text-muted-foreground mt-1 text-xs'>
                {t('Across visible clusters')}
              </div>
            </div>
            <div className='rounded-lg border px-4 py-3'>
              <div className='text-muted-foreground text-xs'>
                {t('Urgent clusters')}
              </div>
              <div className='mt-1 text-2xl font-semibold tabular-nums'>
                {getUrgentClusterCount(summary.items).toLocaleString()}
              </div>
              <div className='text-muted-foreground mt-1 text-xs'>
                {t('High and critical severity')}
              </div>
            </div>
          </div>

          <section className='rounded-lg border p-4'>
            <div className='grid gap-3 md:grid-cols-6'>
              <div className='space-y-1.5'>
                <Label htmlFor='error-workbench-hours'>{t('Time range')}</Label>
                <NativeSelect
                  id='error-workbench-hours'
                  value={filters.timeRange}
                  onChange={(event) =>
                    setFilterValue('timeRange', event.target.value)
                  }
                >
                  <NativeSelectOption value='today'>
                    {t('Today')}
                  </NativeSelectOption>
                  <NativeSelectOption value='yesterday'>
                    {t('Yesterday')}
                  </NativeSelectOption>
                  <NativeSelectOption value='1'>
                    {t('Last 1 hour')}
                  </NativeSelectOption>
                  <NativeSelectOption value='6'>
                    {t('Last 6 hours')}
                  </NativeSelectOption>
                  <NativeSelectOption value='24'>
                    {t('Last 24 hours')}
                  </NativeSelectOption>
                  <NativeSelectOption value='72'>
                    {t('Last 3 days')}
                  </NativeSelectOption>
                  <NativeSelectOption value='168'>
                    {t('Last 7 days')}
                  </NativeSelectOption>
                </NativeSelect>
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='error-workbench-limit'>{t('Limit')}</Label>
                <Input
                  id='error-workbench-limit'
                  type='number'
                  min={1}
                  max={200}
                  value={filters.limit}
                  onChange={(event) =>
                    setFilterValue('limit', Number(event.target.value) || 50)
                  }
                />
              </div>
              <div className='space-y-1.5 md:col-span-2'>
                <Label htmlFor='error-workbench-model'>{t('Model')}</Label>
                <Input
                  id='error-workbench-model'
                  value={filters.modelName}
                  placeholder='gpt-4o'
                  onChange={(event) =>
                    setFilterValue('modelName', event.target.value)
                  }
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='error-workbench-channel'>
                  {t('Channel ID')}
                </Label>
                <Input
                  id='error-workbench-channel'
                  type='number'
                  min={1}
                  value={filters.channel}
                  onChange={(event) =>
                    setFilterValue('channel', event.target.value)
                  }
                />
              </div>
              <div className='space-y-1.5'>
                <Label htmlFor='error-workbench-group'>{t('Group')}</Label>
                <Input
                  id='error-workbench-group'
                  value={filters.group}
                  placeholder='default'
                  onChange={(event) =>
                    setFilterValue('group', event.target.value)
                  }
                />
              </div>
            </div>
            <div className='mt-3 flex flex-wrap items-center gap-2'>
              <Button
                type='button'
                onClick={() => void summaryQuery.refetch()}
                disabled={summaryQuery.isFetching}
              >
                <RefreshCw
                  className={
                    summaryQuery.isFetching ? 'size-4 animate-spin' : 'size-4'
                  }
                />
                {t('Refresh')}
              </Button>
              <Button type='button' variant='outline' onClick={resetFilters}>
                {t('Reset')}
              </Button>
              {summary.truncated && (
                <span className='text-muted-foreground text-xs'>
                  {t('Summary is limited to the latest scanned logs')}
                </span>
              )}
              {summaryQuery.error instanceof Error && (
                <span className='text-destructive text-xs'>
                  {summaryQuery.error.message}
                </span>
              )}
            </div>
          </section>

          <div className='grid min-h-0 gap-4 lg:grid-cols-[minmax(20rem,0.85fr)_minmax(0,1.4fr)]'>
            <ErrorClusterList
              items={summary.items}
              selectedKey={selectedRecord?.key ?? null}
              loading={summaryQuery.isFetching}
              onSelect={setSelectedKey}
            />
            <ErrorClusterDetails
              record={selectedRecord}
              startTime={summary.start_time}
              endTime={summary.end_time}
              testingChannelId={testingChannelId}
              onTestChannel={(channelId, modelName) =>
                testMutation.mutate({ channelId, modelName })
              }
            />
          </div>

          {summary.items.length > 0 && (
            <div className='text-muted-foreground text-xs'>
              {t('Last updated')}: {formatTimestampToDate(summary.end_time)}
            </div>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
