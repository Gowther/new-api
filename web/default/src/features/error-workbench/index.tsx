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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  testChannel as testChannelRequest,
  updateChannel,
  updateChannelStatus,
} from '@/features/channels/api'
import { useDebounce } from '@/hooks'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { formatTimestampToDate } from '@/lib/format'
import { api } from '@/lib/api'

type BackendResponse<T> = {
  success: boolean
  message?: string
  data?: T
}

type ErrorWorkbenchFilters = {
  timeRange: string
  limit: number
  modelName: string
  channel: string
  group: string
}

type ErrorSummaryPeerChannel = {
  channel: number
  channel_name: string
  channel_status: number
  channel_priority: number
  channel_weight: number
  ability_enabled: boolean
  channel_response_time: number
  channel_test_time: number
  automatic_channel_test_disabled: boolean
  auto_test_channel_interval_minutes: number
  multi_key_total: number
  multi_key_enabled: number
  multi_key_auto_disabled: number
  multi_key_manual_disabled: number
  recent_error_count: number
  last_error_time: number
  is_current: boolean
}

type ErrorSummaryItem = {
  key: string
  model_name: string
  channel: number
  channel_name: string
  channel_status: number
  channel_priority: number
  channel_response_time: number
  channel_test_time: number
  automatic_channel_test_disabled: boolean
  auto_test_channel_interval_minutes: number
  multi_key_total: number
  multi_key_enabled: number
  multi_key_auto_disabled: number
  multi_key_manual_disabled: number
  peer_channels: ErrorSummaryPeerChannel[]
  error_type: string
  error_code: string
  status_code: number
  error_summary: string
  count: number
  first_seen: number
  last_seen: number
  sample_content: string
  sample_request_id: string
  sample_upstream_request_id: string
  sample_group: string
  max_use_time: number
}

type ErrorSummaryResponse = {
  items: ErrorSummaryItem[]
  scanned_logs: number
  total_logs: number
  truncated: boolean
  start_time: number
  end_time: number
}

const DEFAULT_FILTERS: ErrorWorkbenchFilters = {
  timeRange: '24',
  limit: 50,
  modelName: '',
  channel: '',
  group: '',
}

const EMPTY_SUMMARY: ErrorSummaryResponse = {
  items: [],
  scanned_logs: 0,
  total_logs: 0,
  truncated: false,
  start_time: 0,
  end_time: 0,
}

const FILTER_INPUT_DEBOUNCE_MS = 500
const CHANNEL_STATUS_ENABLED = 1

function buildSummaryParams(filters: ErrorWorkbenchFilters) {
  const params: Record<string, number | string> = {
    limit: filters.limit,
  }
  const timeRange = buildTimeRangeParams(filters.timeRange)
  Object.assign(params, timeRange)
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

function buildTimeRangeParams(timeRange: string): Record<string, number> {
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

async function getErrorSummary(filters: ErrorWorkbenchFilters) {
  const res = await api.get<BackendResponse<ErrorSummaryResponse>>(
    '/api/log/error_summary',
    {
      params: buildSummaryParams(filters),
      disableDuplicate: true,
    },
  )
  if (!res.data.success) {
    throw new Error(res.data.message || 'Failed to load error summary')
  }
  return res.data.data ?? EMPTY_SUMMARY
}

function channelStatusLabel(status: number, t: (key: string) => string) {
  if (status === 1) return t('Enabled')
  if (status === 2) return t('Manually Disabled')
  if (status === 3) return t('Auto Disabled')
  return t('Unknown')
}

function channelStatusClassName(status: number) {
  if (status === 1) return 'border-emerald-200 text-emerald-700'
  if (status === 2) return 'border-red-200 text-red-700'
  if (status === 3) return 'border-amber-200 text-amber-700'
  return 'border-muted-foreground/30 text-muted-foreground'
}

function statusCodeClassName(statusCode: number) {
  if (statusCode >= 500) return 'border-red-200 text-red-700'
  if (statusCode >= 400) return 'border-amber-200 text-amber-700'
  if (statusCode > 0) return 'border-sky-200 text-sky-700'
  return 'border-muted-foreground/30 text-muted-foreground'
}

function usageLogFilter(record: ErrorSummaryItem) {
  return {
    type: 5,
    channel: record.channel || undefined,
    model_name: record.model_name || undefined,
    group: record.sample_group || undefined,
    request_id: record.sample_request_id || undefined,
    upstream_request_id: record.sample_upstream_request_id || undefined,
  }
}

type PriorityMoveDirection = 'top' | 'up' | 'down' | 'bottom'

function comparePeerChannels(
  a: ErrorSummaryPeerChannel,
  b: ErrorSummaryPeerChannel,
) {
  if (a.channel_priority !== b.channel_priority) {
    return b.channel_priority - a.channel_priority
  }
  if (a.channel_weight !== b.channel_weight) {
    return b.channel_weight - a.channel_weight
  }
  return a.channel - b.channel
}

function isRoutablePeerChannel(peer: ErrorSummaryPeerChannel) {
  return peer.channel_status === CHANNEL_STATUS_ENABLED && peer.ability_enabled
}

function getRoutablePeerChannels(record: ErrorSummaryItem) {
  return (record.peer_channels ?? [])
    .filter(isRoutablePeerChannel)
    .sort(comparePeerChannels)
}

function getPeerChannelDisplayRows(record: ErrorSummaryItem) {
  const routablePeers: ErrorSummaryPeerChannel[] = []
  const contextPeers: ErrorSummaryPeerChannel[] = []

  for (const peer of record.peer_channels ?? []) {
    if (isRoutablePeerChannel(peer)) {
      routablePeers.push(peer)
    } else {
      contextPeers.push(peer)
    }
  }

  routablePeers.sort(comparePeerChannels)
  contextPeers.sort(comparePeerChannels)

  return [
    ...routablePeers.map((peer, index) => ({
      peer,
      routeRank: index + 1,
      isRoutable: true,
    })),
    ...contextPeers.map((peer) => ({
      peer,
      routeRank: null,
      isRoutable: false,
    })),
  ]
}

function occupiedPeerPriorities(
  peers: ErrorSummaryPeerChannel[],
  currentChannel: number,
) {
  const priorities = new Set<number>()
  for (const peer of peers) {
    if (peer.channel !== currentChannel) {
      priorities.add(peer.channel_priority)
    }
  }
  return priorities
}

function nextAvailablePriority(
  priority: number,
  occupiedPriorities: Set<number>,
  step: 1 | -1,
) {
  let nextPriority = priority
  while (occupiedPriorities.has(nextPriority)) {
    nextPriority += step
  }
  return nextPriority
}

function getPriorityMoveTarget(
  record: ErrorSummaryItem,
  direction: PriorityMoveDirection,
) {
  const peers = getRoutablePeerChannels(record)
  const currentIndex = peers.findIndex(
    (peer) => peer.channel === record.channel,
  )
  if (currentIndex < 0 || peers.length < 2) return null

  const currentPeer = peers[currentIndex]
  const otherPeers = peers.filter((peer) => peer.channel !== record.channel)
  const occupiedPriorities = occupiedPeerPriorities(peers, record.channel)

  if (direction === 'top') {
    const highestOtherPriority = Math.max(
      ...otherPeers.map((peer) => peer.channel_priority),
    )
    if (currentPeer.channel_priority > highestOtherPriority) return null
    return nextAvailablePriority(
      highestOtherPriority + 1,
      occupiedPriorities,
      1,
    )
  }
  if (direction === 'bottom') {
    const lowestOtherPriority = Math.min(
      ...otherPeers.map((peer) => peer.channel_priority),
    )
    if (currentPeer.channel_priority < lowestOtherPriority) return null
    return nextAvailablePriority(
      lowestOtherPriority - 1,
      occupiedPriorities,
      -1,
    )
  }
  if (direction === 'up') {
    if (currentIndex === 0) return null
    return nextAvailablePriority(
      peers[currentIndex - 1].channel_priority + 1,
      occupiedPriorities,
      1,
    )
  }
  if (currentIndex === peers.length - 1) return null
  return nextAvailablePriority(
    peers[currentIndex + 1].channel_priority - 1,
    occupiedPriorities,
    -1,
  )
}

function canMovePriority(
  record: ErrorSummaryItem,
  direction: PriorityMoveDirection,
) {
  return getPriorityMoveTarget(record, direction) !== null
}

type ChannelAction =
  | { type: 'test'; record: ErrorSummaryItem }
  | { type: 'status'; record: ErrorSummaryItem; status: number }
  | { type: 'priority'; record: ErrorSummaryItem; priority: number }

export function ErrorWorkbench() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<ErrorWorkbenchFilters>(DEFAULT_FILTERS)
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

  const actionMutation = useMutation({
    mutationFn: async (action: ChannelAction) => {
      if (!action.record.channel) {
        throw new Error(t('This error log has no channel ID'))
      }

      if (action.type === 'test') {
        const res = await testChannelRequest(
          action.record.channel,
          action.record.model_name
            ? { model: action.record.model_name }
            : undefined,
        )
        if (!res.success) {
          throw new Error(res.message || t('Channel test failed'))
        }
        return t('Channel test succeeded')
      }

      if (action.type === 'status') {
        const res = await updateChannelStatus(
          action.record.channel,
          action.status,
        )
        if (!res.success) {
          throw new Error(res.message || t('Operation failed'))
        }
        return t('Operation completed successfully')
      }

      const res = await updateChannel(action.record.channel, {
        priority: action.priority,
      })
      if (!res.success) {
        throw new Error(res.message || t('Update failed'))
      }
      return t('Updated successfully')
    },
    onSuccess: (message) => {
      toast.success(message)
      queryClient.invalidateQueries({
        queryKey: ['error-workbench-summary'],
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : t('Operation failed'),
      )
    },
  })

  const setFilterValue = (
    key: keyof ErrorWorkbenchFilters,
    value: string | number,
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS)
  }

  const copyFilter = async (record: ErrorSummaryItem) => {
    const ok = await copyToClipboard(
      JSON.stringify(usageLogFilter(record), null, 2),
    )
    if (ok) {
      toast.success(t('Copied to clipboard'))
    } else {
      toast.error(t('Failed to copy to clipboard'))
    }
  }

  const movePriority = (
    record: ErrorSummaryItem,
    direction: PriorityMoveDirection,
  ) => {
    const priority = getPriorityMoveTarget(record, direction)
    if (priority === null) {
      toast.info(t('No peer channel context'))
      return
    }
    actionMutation.mutate({ type: 'priority', record, priority })
  }

  const renderPeerChannels = (record: ErrorSummaryItem) => {
    const peerRows = getPeerChannelDisplayRows(record)
    if (peerRows.length === 0) {
      return (
        <div className='text-muted-foreground mt-2 text-xs'>
          {t('No peer channel context')}
        </div>
      )
    }
    return (
      <div className='bg-muted/30 max-h-56 space-y-2 overflow-y-auto rounded-lg border p-2'>
        <div className='text-muted-foreground text-xs'>
          {t('Same model channels')} · {t('Ordered by priority, then weight')}
        </div>
        {peerRows.map(({ peer, routeRank, isRoutable }) => (
          <div
            key={peer.channel}
            className={[
              peer.is_current
                ? 'rounded-md border border-amber-200 bg-amber-50/70 p-2'
                : 'rounded-md border bg-background p-2',
              isRoutable ? '' : 'opacity-60',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className='flex flex-wrap items-center gap-1'>
              <Badge variant='outline'>
                {routeRank === null ? '-' : `#${routeRank}`}
              </Badge>
              <span className='text-sm font-medium'>
                {peer.channel_name || t('Unknown channel')} #{peer.channel}
              </span>
              {peer.is_current && (
                <Badge variant='outline' className='border-amber-200'>
                  {t('Current')}
                </Badge>
              )}
            </div>
            <div className='mt-1 flex flex-wrap gap-1'>
              <Badge
                variant='outline'
                className={channelStatusClassName(peer.channel_status)}
              >
                {channelStatusLabel(peer.channel_status, t)}
              </Badge>
              <Badge variant='outline'>
                {t('Priority')} {peer.channel_priority || 0}
              </Badge>
              <Badge variant='outline'>
                {t('Weight')} {peer.channel_weight || 0}
              </Badge>
              <Badge variant='outline'>
                {t('Recent errors')} {peer.recent_error_count || 0}
              </Badge>
              {peer.automatic_channel_test_disabled && (
                <Badge
                  variant='outline'
                  className='border-red-200 text-red-700'
                >
                  {t('Skipped')}
                </Badge>
              )}
              {peer.multi_key_total > 0 && (
                <Badge variant='outline'>
                  {t('Multi-key')} {peer.multi_key_enabled}/
                  {peer.multi_key_total}
                </Badge>
              )}
            </div>
          </div>
        ))}
      </div>
    )
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
          variant='outline'
          render={
            <Link to='/usage-logs/$section' params={{ section: 'common' }} />
          }
        >
          {t('Open usage logs')}
        </Button>
        <Button variant='outline' render={<Link to='/channels' />}>
          {t('Open channels')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <div className='grid gap-3 md:grid-cols-3'>
            <Card data-card-hover='false'>
              <CardHeader className='pb-2'>
                <CardDescription>{t('Error logs')}</CardDescription>
                <CardTitle>{summary.total_logs}</CardTitle>
              </CardHeader>
              <CardContent className='text-muted-foreground text-sm'>
                {t('Errors in the selected time range')}
              </CardContent>
            </Card>
            <Card data-card-hover='false'>
              <CardHeader className='pb-2'>
                <CardDescription>{t('Error groups')}</CardDescription>
                <CardTitle>{summary.items.length}</CardTitle>
              </CardHeader>
              <CardContent className='text-muted-foreground text-sm'>
                {t('Grouped by model, channel, code, and message')}
              </CardContent>
            </Card>
            <Card data-card-hover='false'>
              <CardHeader className='pb-2'>
                <CardDescription>{t('Scanned logs')}</CardDescription>
                <CardTitle>{summary.scanned_logs}</CardTitle>
              </CardHeader>
              <CardContent className='text-muted-foreground text-sm'>
                {summary.truncated
                  ? t('Only the latest scanned logs are summarized')
                  : t('All matching logs are summarized')}
              </CardContent>
            </Card>
          </div>

          <Card data-card-hover='false'>
            <CardHeader>
              <CardTitle>{t('Filters')}</CardTitle>
              <CardDescription>
                {t('Narrow the scope before adjusting channels.')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className='grid gap-3 md:grid-cols-6'>
                <div className='space-y-1.5'>
                  <Label htmlFor='error-workbench-hours'>
                    {t('Time range')}
                  </Label>
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
              <div className='mt-4 flex flex-wrap gap-2'>
                <Button
                  onClick={() => summaryQuery.refetch()}
                  disabled={summaryQuery.isFetching}
                >
                  {summaryQuery.isFetching && (
                    <RefreshCw className='animate-spin' />
                  )}
                  {t('Refresh')}
                </Button>
                <Button variant='outline' onClick={resetFilters}>
                  {t('Reset')}
                </Button>
                {summary.truncated && (
                  <Badge
                    variant='outline'
                    className='border-amber-200 text-amber-700'
                  >
                    {t('Summary is limited to the latest scanned logs')}
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          <Card data-card-hover='false'>
            <CardHeader>
              <CardTitle>{t('Error summary')}</CardTitle>
              <CardDescription>
                {t(
                  'Use channel actions only after confirming the error pattern.',
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-[120px]'>{t('Count')}</TableHead>
                    <TableHead className='w-[190px]'>{t('Model')}</TableHead>
                    <TableHead className='w-[300px]'>{t('Channel')}</TableHead>
                    <TableHead>{t('Error')}</TableHead>
                    <TableHead className='w-[210px]'>
                      {t('Auto test')}
                    </TableHead>
                    <TableHead className='w-[320px]'>
                      {t('Same model channels')}
                    </TableHead>
                    <TableHead className='text-right'>{t('Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.items.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className='text-muted-foreground h-28 text-center'
                      >
                        {summaryQuery.isFetching
                          ? t('Loading...')
                          : t('No error logs found')}
                      </TableCell>
                    </TableRow>
                  )}
                  {summary.items.map((record) => (
                    <TableRow key={record.key}>
                      <TableCell className='align-top'>
                        <div className='text-2xl font-semibold leading-none text-red-600 tabular-nums'>
                          {record.count}
                        </div>
                        <div className='text-muted-foreground mt-2 space-y-1 text-xs'>
                          <div>
                            {t('Latest')}:{' '}
                            {formatTimestampToDate(record.last_seen)}
                          </div>
                          <div>
                            {t('First')}:{' '}
                            {formatTimestampToDate(record.first_seen)}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className='align-top'>
                        {record.model_name ? (
                          <div className='space-y-1.5'>
                            <div className='max-w-[180px] truncate font-mono text-sm font-semibold'>
                              {record.model_name}
                            </div>
                            {record.sample_group && (
                              <Badge variant='outline'>
                                {record.sample_group}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className='text-muted-foreground'>-</span>
                        )}
                      </TableCell>
                      <TableCell className='align-top'>
                        <div className='max-w-[280px] truncate font-semibold'>
                          {record.channel_name || t('Unknown channel')}
                        </div>
                        <div className='text-muted-foreground text-xs'>
                          #{record.channel || '-'}
                        </div>
                        <div className='mt-1 flex flex-wrap gap-1'>
                          <Badge
                            variant='outline'
                            className={channelStatusClassName(
                              record.channel_status,
                            )}
                          >
                            {channelStatusLabel(record.channel_status, t)}
                          </Badge>
                          <Badge
                            variant='outline'
                            className='border-sky-200 font-medium text-sky-700'
                          >
                            {t('Priority')} {record.channel_priority || 0}
                          </Badge>
                          {record.channel_response_time > 0 && (
                            <Badge variant='outline'>
                              {record.channel_response_time} ms
                            </Badge>
                          )}
                        </div>
                        <div className='text-muted-foreground mt-1 text-xs'>
                          {t('Last tested')}:{' '}
                          {formatTimestampToDate(record.channel_test_time)}
                        </div>
                      </TableCell>
                      <TableCell className='max-w-[420px] align-top whitespace-normal'>
                        <div className='flex flex-wrap items-center gap-1'>
                          <Badge
                            variant='outline'
                            className={[
                              statusCodeClassName(record.status_code),
                              'font-semibold',
                            ].join(' ')}
                          >
                            {record.status_code || t('No status code')}
                          </Badge>
                          {record.error_type && (
                            <Badge
                              variant='outline'
                              className='border-red-200 text-red-700'
                            >
                              {record.error_type}
                            </Badge>
                          )}
                          {record.error_code && (
                            <Badge
                              variant='outline'
                              className='border-amber-200 text-amber-700'
                            >
                              {record.error_code}
                            </Badge>
                          )}
                        </div>
                        <Tooltip>
                          <TooltipTrigger
                            render={<p className='mt-2 line-clamp-3' />}
                            className='cursor-help text-sm font-medium leading-5'
                          >
                            {record.error_summary || t('No error message')}
                          </TooltipTrigger>
                          <TooltipContent className='max-w-xl whitespace-pre-wrap'>
                            {record.sample_content || record.error_summary}
                          </TooltipContent>
                        </Tooltip>
                        {(record.sample_request_id ||
                          record.sample_upstream_request_id) && (
                          <div className='text-muted-foreground mt-1 text-xs'>
                            <span className='font-mono'>
                              {record.sample_request_id ||
                                record.sample_upstream_request_id}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className='align-top'>
                        <div className='space-y-2'>
                          <div className='flex flex-wrap gap-1'>
                            {record.automatic_channel_test_disabled ? (
                              <Badge
                                variant='outline'
                                className='border-red-200 font-medium text-red-700'
                              >
                                {t('Skipped')}
                              </Badge>
                            ) : (
                              <Badge
                                variant='outline'
                                className='border-emerald-200 font-medium text-emerald-700'
                              >
                                {t('Enabled')}
                              </Badge>
                            )}
                            {record.auto_test_channel_interval_minutes > 0 && (
                              <Badge variant='outline'>
                                {record.auto_test_channel_interval_minutes}{' '}
                                {t('minutes')}
                              </Badge>
                            )}
                          </div>
                          {record.multi_key_total > 0 && (
                            <div className='rounded-md border bg-muted/30 p-2'>
                              <div className='font-semibold tabular-nums'>
                                {record.multi_key_enabled}/
                                {record.multi_key_total}
                              </div>
                              <div className='text-muted-foreground text-xs'>
                                {t('Multi-key')}
                              </div>
                              <div className='mt-1 flex flex-wrap gap-1'>
                                {record.multi_key_auto_disabled > 0 && (
                                  <Badge
                                    variant='outline'
                                    className='border-amber-200 text-amber-700'
                                  >
                                    {t('auto disabled')}{' '}
                                    {record.multi_key_auto_disabled}
                                  </Badge>
                                )}
                                {record.multi_key_manual_disabled > 0 && (
                                  <Badge
                                    variant='outline'
                                    className='border-red-200 text-red-700'
                                  >
                                    {t('manual disabled')}{' '}
                                    {record.multi_key_manual_disabled}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className='w-[320px] align-top'>
                        {renderPeerChannels(record)}
                      </TableCell>
                      <TableCell className='align-top'>
                        <div className='flex justify-end gap-1'>
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={actionMutation.isPending}
                            onClick={() =>
                              actionMutation.mutate({
                                type: 'test',
                                record,
                              })
                            }
                          >
                            {t('Test')}
                          </Button>
                          <Button
                            size='sm'
                            variant={
                              record.channel_status === 1
                                ? 'destructive'
                                : 'outline'
                            }
                            disabled={actionMutation.isPending}
                            onClick={() =>
                              actionMutation.mutate({
                                type: 'status',
                                record,
                                status: record.channel_status === 1 ? 2 : 1,
                              })
                            }
                          >
                            {record.channel_status === 1
                              ? t('Disable')
                              : t('Enable')}
                          </Button>
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() => copyFilter(record)}
                          >
                            {t('Copy filter')}
                          </Button>
                        </div>
                        <div className='mt-2 flex justify-end gap-2'>
                          <span className='text-muted-foreground text-xs'>
                            {t('Route order')}
                          </span>
                        </div>
                        <div className='mt-1 flex flex-wrap justify-end gap-1'>
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={
                              actionMutation.isPending ||
                              !canMovePriority(record, 'top')
                            }
                            onClick={() => movePriority(record, 'top')}
                          >
                            {t('Move top')}
                          </Button>
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={
                              actionMutation.isPending ||
                              !canMovePriority(record, 'up')
                            }
                            onClick={() => movePriority(record, 'up')}
                          >
                            {t('Move up')}
                          </Button>
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={
                              actionMutation.isPending ||
                              !canMovePriority(record, 'down')
                            }
                            onClick={() => movePriority(record, 'down')}
                          >
                            {t('Move down')}
                          </Button>
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={
                              actionMutation.isPending ||
                              !canMovePriority(record, 'bottom')
                            }
                            onClick={() => movePriority(record, 'bottom')}
                          >
                            {t('Move bottom')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
