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
import { ArrowDownRight, ArrowUpRight, CircleDot, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { formatErrorRate } from '../lib'
import type { ErrorSummaryItem } from '../types'
import { ErrorMetricHelp, RouteErrorRateHelp } from './error-metric-help'
import { ErrorRouteIdentity } from './error-route-identity'

type ErrorClusterListProps = {
  items: ErrorSummaryItem[]
  selectedKey: string | null
  loading: boolean
  onSelect: (key: string) => void
}

const severityClassNames: Record<string, string> = {
  critical: 'border-red-300 bg-red-50 text-red-800 dark:bg-red-950/30',
  high: 'border-orange-300 bg-orange-50 text-orange-800 dark:bg-orange-950/30',
  medium: 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30',
  low: 'border-border bg-muted/40 text-muted-foreground',
}

function TrendIndicator(props: { trend: string }) {
  const { t } = useTranslation()
  let icon = <CircleDot className='size-3.5' />
  let label = t('Stable')
  let className = 'text-muted-foreground'

  if (props.trend === 'new') {
    icon = <Sparkles className='size-3.5' />
    label = t('New')
    className = 'text-sky-700 dark:text-sky-300'
  } else if (props.trend === 'rising') {
    icon = <ArrowUpRight className='size-3.5' />
    label = t('Rising')
    className = 'text-red-700 dark:text-red-300'
  } else if (props.trend === 'falling') {
    icon = <ArrowDownRight className='size-3.5' />
    label = t('Falling')
    className = 'text-emerald-700 dark:text-emerald-300'
  }

  return (
    <ErrorMetricHelp
      description={t(
        "Trend compares this cluster's error-log count in the newer half of the selected time range with the older half. New means only the newer half has errors; rising or falling requires a meaningful change; otherwise it is stable."
      )}
      showIcon={false}
      className={cn('gap-1 text-xs', className)}
    >
      {icon}
      {label}
    </ErrorMetricHelp>
  )
}

export function ErrorClusterList(props: ErrorClusterListProps) {
  const { t } = useTranslation()

  return (
    <section className='bg-background flex h-[32rem] min-w-0 flex-col overflow-hidden rounded-lg border lg:h-full'>
      <div className='flex items-center justify-between gap-3 border-b px-3 py-2.5'>
        <h2 className='text-sm font-semibold'>
          <ErrorMetricHelp
            description={t(
              'A fault cluster groups error logs by model, group, channel, and a normalized error fingerprint. The visible list is ranked by severity and capped by the fault cluster limit.'
            )}
          >
            {t('Fault clusters')}
          </ErrorMetricHelp>
        </h2>
        <span className='text-muted-foreground text-xs tabular-nums'>
          {props.items.length}
        </span>
      </div>
      <ScrollArea className='min-h-0 flex-1 overscroll-contain'>
        {props.items.length === 0 ? (
          <div className='text-muted-foreground flex min-h-80 items-center justify-center px-6 text-center text-sm'>
            {props.loading ? t('Loading...') : t('No error logs found')}
          </div>
        ) : (
          <div className='divide-y'>
            {props.items.map((item) => {
              const selected = item.key === props.selectedKey
              let severityLabel = t('Low')
              if (item.severity === 'critical') {
                severityLabel = t('Critical')
              } else if (item.severity === 'high') {
                severityLabel = t('High')
              } else if (item.severity === 'medium') {
                severityLabel = t('Medium')
              }
              return (
                <button
                  key={item.key}
                  type='button'
                  aria-pressed={selected}
                  onClick={() => props.onSelect(item.key)}
                  className={cn(
                    'hover:bg-muted/50 focus-visible:ring-ring w-full px-3 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none',
                    selected && 'bg-muted'
                  )}
                >
                  <div className='flex min-w-0 items-start justify-between gap-3'>
                    <div className='min-w-0 space-y-1.5'>
                      <div className='flex flex-wrap items-center gap-1.5'>
                        <ErrorMetricHelp
                          description={t(
                            'Severity uses channel status, HTTP status, route error rate, route attempts, and cluster error-log count. Critical requires an enabled channel with at least 5 attempts and at least 50% errors; high covers enabled-channel authentication, server, or at least 20% route errors; medium covers HTTP errors or at least 3 logs; otherwise severity is low.'
                          )}
                          showIcon={false}
                        >
                          <Badge
                            variant='outline'
                            className={cn(
                              'text-[11px]',
                              severityClassNames[item.severity] ??
                                severityClassNames.low
                            )}
                          >
                            {severityLabel}
                          </Badge>
                        </ErrorMetricHelp>
                        {item.status_code > 0 && (
                          <Badge
                            variant='outline'
                            className='font-mono text-[11px]'
                          >
                            {item.status_code}
                          </Badge>
                        )}
                        <TrendIndicator trend={item.trend} />
                      </div>
                      <p className='line-clamp-2 text-sm leading-5 font-medium break-all'>
                        {item.error_summary || t('No error message')}
                      </p>
                      <ErrorRouteIdentity
                        modelName={item.model_name}
                        group={item.group}
                        channelName={item.channel_name}
                        channelId={item.channel}
                        compact
                      />
                    </div>
                    <div className='shrink-0 text-right'>
                      <RouteErrorRateHelp
                        errors={item.route_error_count}
                        attempts={item.route_attempt_count}
                        rate={formatErrorRate(item.route_error_rate)}
                        className='flex-col items-end gap-0'
                      >
                        <span className='text-lg font-semibold tabular-nums'>
                          {formatErrorRate(item.route_error_rate)}
                        </span>
                        <span className='text-muted-foreground text-[11px]'>
                          {t('Route error rate')}
                        </span>
                      </RouteErrorRateHelp>
                    </div>
                  </div>
                  <div className='text-muted-foreground mt-3 flex flex-wrap items-center justify-between gap-2 text-xs'>
                    <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
                      <ErrorMetricHelp
                        description={t(
                          'Cluster error logs counts error-log rows with this exact fingerprint in the selected time range. Retries can produce more than one row for a request.'
                        )}
                      >
                        <span>
                          {t('Cluster error logs')}: {item.count}
                        </span>
                      </ErrorMetricHelp>
                      <ErrorMetricHelp
                        description={t(
                          'Affected requests counts distinct failed requests in this fault cluster. It deduplicates by request ID, then upstream request ID, and falls back to log ID. It is not used to calculate route error rate.'
                        )}
                      >
                        <span>
                          {t('Affected requests')}: {item.affected_requests}
                        </span>
                      </ErrorMetricHelp>
                    </div>
                    <span>{formatTimestampToDate(item.last_seen)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </ScrollArea>
    </section>
  )
}
