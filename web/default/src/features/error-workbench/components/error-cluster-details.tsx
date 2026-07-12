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
import { Link } from '@tanstack/react-router'
import {
  Activity,
  ExternalLink,
  FileSearch,
  FileWarning,
  Gauge,
  Loader2,
  Route,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { formatTimestampToDate } from '@/lib/format'

import { formatErrorRate } from '../lib'
import type { ErrorSummaryItem, ErrorSummaryPeerChannel } from '../types'

type ErrorClusterDetailsProps = {
  record: ErrorSummaryItem | null
  startTime: number
  endTime: number
  testingChannelId: number | null
  onTestChannel: (channelId: number, modelName: string) => void
}

function getChannelStatusClassName(status: number): string {
  if (status === 1) return 'border-emerald-300 text-emerald-700'
  if (status === 2) return 'border-red-300 text-red-700'
  if (status === 3) return 'border-amber-300 text-amber-700'
  return 'text-muted-foreground'
}

function DetailMetric(props: {
  label: string
  value: string | number
  icon: ReactNode
}) {
  return (
    <div className='bg-muted/25 min-w-0 rounded-md border px-3 py-2.5'>
      <div className='text-muted-foreground flex items-center gap-1.5 text-xs'>
        {props.icon}
        {props.label}
      </div>
      <div className='mt-1 truncate text-base font-semibold tabular-nums'>
        {props.value}
      </div>
    </div>
  )
}

function PeerChannelRow(props: {
  peer: ErrorSummaryPeerChannel
  modelName: string
  testingChannelId: number | null
  onTestChannel: (channelId: number, modelName: string) => void
}) {
  const { t } = useTranslation()
  const testing = props.testingChannelId === props.peer.channel
  let channelStatusLabel = t('Unknown')
  if (props.peer.channel_status === 1) {
    channelStatusLabel = t('Enabled')
  } else if (props.peer.channel_status === 2) {
    channelStatusLabel = t('Manually Disabled')
  } else if (props.peer.channel_status === 3) {
    channelStatusLabel = t('Auto Disabled')
  }

  return (
    <div
      className={cn(
        'grid gap-3 px-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center',
        props.peer.is_current && 'bg-amber-50/60 dark:bg-amber-950/15',
      )}
    >
      <div className='min-w-0 space-y-1.5'>
        <div className='flex min-w-0 flex-wrap items-center gap-1.5'>
          <span className='max-w-64 truncate text-sm font-medium'>
            {props.peer.channel_name || t('Unknown channel')}
          </span>
          <span className='text-muted-foreground font-mono text-xs'>
            #{props.peer.channel}
          </span>
          {props.peer.is_current && (
            <Badge
              variant='outline'
              className='border-amber-300 text-amber-700'
            >
              {t('Current')}
            </Badge>
          )}
          <Badge
            variant='outline'
            className={getChannelStatusClassName(props.peer.channel_status)}
          >
            {channelStatusLabel}
          </Badge>
        </div>
        <div className='text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs'>
          <span>
            {t('Error rate')} {formatErrorRate(props.peer.recent_error_rate)}
          </span>
          <span>
            {t('Attempts')} {props.peer.recent_attempt_count || 0}
          </span>
          <span>
            {t('Priority')} {props.peer.channel_priority || 0}
          </span>
          <span>
            {t('Weight')} {props.peer.channel_weight || 0}
          </span>
        </div>
      </div>
      <Button
        type='button'
        size='sm'
        variant='outline'
        disabled={testing}
        onClick={() => props.onTestChannel(props.peer.channel, props.modelName)}
      >
        {testing ? (
          <Loader2 className='size-4 animate-spin' />
        ) : (
          <Gauge className='size-4' />
        )}
        {t('Test')}
      </Button>
    </div>
  )
}

export function ErrorClusterDetails(props: ErrorClusterDetailsProps) {
  const { t } = useTranslation()
  const record = props.record

  if (!record) {
    return (
      <section className='bg-background text-muted-foreground flex min-h-[32rem] items-center justify-center rounded-lg border px-6 text-center text-sm'>
        {t('Select a fault cluster')}
      </section>
    )
  }

  const logSearch = {
    type: ['5'] as const,
    model: record.model_name || undefined,
    channel: record.channel ? String(record.channel) : undefined,
    group: record.group || undefined,
    startTime: props.startTime || undefined,
    endTime: props.endTime || undefined,
  }
  const sampleSearch = {
    ...logSearch,
    requestId: record.sample_request_id || undefined,
    upstreamRequestId: record.sample_upstream_request_id || undefined,
  }

  return (
    <section className='bg-background flex min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-lg border'>
      <div className='flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3'>
        <div className='min-w-0 space-y-1'>
          <div className='flex flex-wrap items-center gap-1.5'>
            {record.status_code > 0 && (
              <Badge variant='outline' className='font-mono'>
                {record.status_code}
              </Badge>
            )}
            {record.error_type && (
              <Badge variant='outline' className='max-w-full break-all'>
                {record.error_type}
              </Badge>
            )}
            {record.error_code && (
              <Badge variant='outline' className='max-w-full break-all'>
                {record.error_code}
              </Badge>
            )}
          </div>
          <h2 className='break-all text-base font-semibold leading-6'>
            {record.error_summary || t('No error message')}
          </h2>
          <p className='text-muted-foreground text-xs font-mono'>
            {record.fingerprint}
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            size='sm'
            variant='outline'
            render={
              <Link
                to='/usage-logs/$section'
                params={{ section: 'common' }}
                search={logSearch}
              />
            }
          >
            <FileSearch className='size-4' />
            {t('View logs')}
          </Button>
          <Button
            size='sm'
            variant='outline'
            render={
              <Link
                to='/models/$section'
                params={{ section: 'routing' }}
                search={{
                  routingModel: record.model_name || undefined,
                  routingGroup: record.group || undefined,
                  routingChannel: record.channel || undefined,
                }}
              />
            }
          >
            <Route className='size-4' />
            {t('View route')}
          </Button>
        </div>
      </div>

      <ScrollArea className='min-h-0 flex-1'>
        <div className='space-y-5 p-4'>
          <div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-4'>
            <DetailMetric
              label={t('Error rate')}
              value={formatErrorRate(record.route_error_rate)}
              icon={<Activity className='size-3.5' />}
            />
            <DetailMetric
              label={t('Affected requests')}
              value={record.affected_requests}
              icon={<FileWarning className='size-3.5' />}
            />
            <DetailMetric
              label={t('Affected users')}
              value={record.affected_users}
              icon={<Users className='size-3.5' />}
            />
            <DetailMetric
              label={t('Attempts')}
              value={record.route_attempt_count}
              icon={<Gauge className='size-3.5' />}
            />
          </div>

          <div className='grid gap-4 text-sm sm:grid-cols-2'>
            <div className='space-y-2'>
              <div className='text-muted-foreground text-xs'>{t('Route')}</div>
              <div className='space-y-1'>
                <div className='break-all font-mono'>
                  {record.model_name || '-'}
                </div>
                <div className='text-muted-foreground'>
                  {record.group || '-'} ·{' '}
                  {record.channel_name || t('Unknown channel')} #
                  {record.channel || '-'}
                </div>
              </div>
            </div>
            <div className='space-y-2'>
              <div className='text-muted-foreground text-xs'>
                {t('Timeline')}
              </div>
              <div className='space-y-1 tabular-nums'>
                <div>
                  {t('First')}: {formatTimestampToDate(record.first_seen)}
                </div>
                <div>
                  {t('Latest')}: {formatTimestampToDate(record.last_seen)}
                </div>
              </div>
            </div>
          </div>

          <Separator />

          <div className='space-y-2'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <h3 className='text-sm font-semibold'>{t('Sample error')}</h3>
              {(record.sample_request_id ||
                record.sample_upstream_request_id) && (
                <Button
                  size='sm'
                  variant='ghost'
                  render={
                    <Link
                      to='/usage-logs/$section'
                      params={{ section: 'common' }}
                      search={sampleSearch}
                    />
                  }
                >
                  <ExternalLink className='size-4' />
                  {t('Open sample')}
                </Button>
              )}
            </div>
            <pre className='bg-muted/35 max-h-64 overflow-auto rounded-md border p-3 text-xs leading-5 break-words whitespace-pre-wrap'>
              {record.sample_content || record.error_summary || '-'}
            </pre>
            {(record.sample_request_id ||
              record.sample_upstream_request_id) && (
              <div className='text-muted-foreground truncate font-mono text-xs'>
                {record.sample_request_id || record.sample_upstream_request_id}
              </div>
            )}
          </div>

          <Separator />

          <div className='space-y-2'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div>
                <h3 className='text-sm font-semibold'>
                  {t('Current channel')}
                </h3>
                <p className='text-muted-foreground text-xs'>
                  {record.automatic_channel_test_disabled
                    ? t('Automatic channel test is disabled')
                    : t('Automatic channel test is enabled')}
                </p>
              </div>
              <Button
                type='button'
                size='sm'
                disabled={
                  !record.channel || props.testingChannelId === record.channel
                }
                onClick={() =>
                  props.onTestChannel(record.channel, record.model_name)
                }
              >
                {props.testingChannelId === record.channel ? (
                  <Loader2 className='size-4 animate-spin' />
                ) : (
                  <Gauge className='size-4' />
                )}
                {t('Test current channel')}
              </Button>
            </div>
            <div className='text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs'>
              <span>
                {t('Last tested')}:{' '}
                {formatTimestampToDate(record.channel_test_time)}
              </span>
              <span>
                {t('Response time')}: {record.channel_response_time || 0} ms
              </span>
              <span>
                {t('Priority')}: {record.channel_priority || 0}
              </span>
            </div>
          </div>

          <Separator />

          <div className='space-y-2'>
            <div className='flex items-center justify-between gap-2'>
              <h3 className='text-sm font-semibold'>{t('Route comparison')}</h3>
              <span className='text-muted-foreground text-xs tabular-nums'>
                {record.peer_channels?.length || 0}
              </span>
            </div>
            <div className='divide-y overflow-hidden rounded-md border'>
              {(record.peer_channels ?? []).length === 0 ? (
                <div className='text-muted-foreground px-3 py-8 text-center text-sm'>
                  {t('No peer channel context')}
                </div>
              ) : (
                record.peer_channels.map((peer) => (
                  <PeerChannelRow
                    key={peer.channel}
                    peer={peer}
                    modelName={record.model_name}
                    testingChannelId={props.testingChannelId}
                    onTestChannel={props.onTestChannel}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </ScrollArea>
    </section>
  )
}
