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
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { VChart } from '@visactor/react-vchart'
import {
  BarChart3,
  Clock,
  Key,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatQuotaWithCurrency } from '@/lib/currency'
import dayjs from '@/lib/dayjs'
import { VCHART_OPTION } from '@/lib/vchart'
import { useTheme } from '@/context/theme-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SectionPageLayout } from '@/components/layout'
import { getTokenUsageSelf } from './api'
import type {
  TokenUsageDetailItem,
  TokenUsageQueryParams,
  TokenUsageSelfResponse,
  TokenUsageTokenItem,
} from './types'

type RangeOption =
  | {
      labelKey: string
      mode: 'today'
      granularity: 'hour'
    }
  | {
      labelKey: string
      mode: 'relative'
      days: number
      granularity: 'hour' | 'day'
    }

type CustomRange = {
  start: string
  end: string
}

const CUSTOM_RANGE_VALUE = 'custom'

const RANGE_OPTIONS: RangeOption[] = [
  { labelKey: 'Today', mode: 'today', granularity: 'hour' },
  { labelKey: 'Last 24 hours', mode: 'relative', days: 1, granularity: 'hour' },
  { labelKey: 'Last 7 days', mode: 'relative', days: 7, granularity: 'day' },
  { labelKey: 'Last 30 days', mode: 'relative', days: 30, granularity: 'day' },
  { labelKey: 'Last 90 days', mode: 'relative', days: 90, granularity: 'day' },
]

const API_KEY_COLORS = [
  '#2563eb',
  '#10b981',
  '#f59e0b',
  '#e11d48',
  '#8b5cf6',
  '#06b6d4',
  '#84cc16',
  '#64748b',
  '#f97316',
  '#14b8a6',
  '#d946ef',
  '#0ea5e9',
]

const TOKEN_COUNT_UNITS = [
  { value: 1000000000000, suffix: 'T' },
  { value: 1000000000, suffix: 'B' },
  { value: 1000000, suffix: 'M' },
  { value: 1000, suffix: 'K' },
]

function emptyTokenUsage(): TokenUsageSelfResponse {
  return {
    summary: {
      total_requests: 0,
      total_quota: 0,
      total_prompt_tokens: 0,
      total_completion_tokens: 0,
      total_tokens: 0,
      total_cache_read_tokens: 0,
      total_cache_write_tokens: 0,
      api_key_count: 0,
      model_count: 0,
    },
    trend: [],
    by_token: [],
    by_model: [],
    rows: [],
  }
}

function formatInteger(value: number) {
  return Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    value || 0
  )
}

function toFiniteNumber(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function formatCompactTokenCount(value: unknown) {
  const numeric = toFiniteNumber(value)
  const abs = Math.abs(numeric)
  const unit = TOKEN_COUNT_UNITS.find((item) => abs >= item.value)

  if (!unit) {
    return formatInteger(numeric)
  }

  const scaled = numeric / unit.value
  return `${Intl.NumberFormat(undefined, {
    maximumFractionDigits: Math.abs(scaled) < 10 ? 1 : 0,
  }).format(scaled)}${unit.suffix}`
}

function formatCompactWithFullValue(value: unknown) {
  const numeric = toFiniteNumber(value)
  const compact = formatCompactTokenCount(numeric)
  const full = formatInteger(numeric)
  return compact === full ? full : `${compact} (${full})`
}

function formatChartTokenLabel(
  value: unknown,
  datum?: { tokens?: unknown }
) {
  return formatCompactTokenCount(datum?.tokens ?? value)
}

function cacheTokenParts(row: TokenUsageDetailItem) {
  return {
    read: row.cache_read_tokens || 0,
    write: row.cache_write_tokens || 0,
  }
}

function formatPercent(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0%'
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}%`
}

function formatHourRange(timestamp: number) {
  if (timestamp <= 0) return '-'
  const start = dayjs(timestamp * 1000)
  const end = start.add(1, 'hour')
  const endText = start.isSame(end, 'day')
    ? end.format('HH:mm')
    : end.format('YYYY-MM-DD HH:mm')
  return `${start.format('YYYY-MM-DD HH:mm')}-${endText}`
}

function dateTimeLocalFromTimestamp(timestamp: number) {
  return dayjs(timestamp * 1000).format('YYYY-MM-DDTHH:mm')
}

function parseDateTimeLocal(value: string) {
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.unix() : 0
}

function nextHourTimestamp(timestamp: number) {
  const hour = timestamp - (timestamp % 3600)
  return timestamp === hour ? hour : hour + 3600
}

function getDefaultCustomRange(): CustomRange {
  const endTimestamp = nextHourTimestamp(Math.floor(Date.now() / 1000))
  return {
    start: dateTimeLocalFromTimestamp(endTimestamp - 24 * 3600),
    end: dateTimeLocalFromTimestamp(endTimestamp),
  }
}

function customRangeGranularity(
  startTimestamp: number,
  endTimestamp: number
): 'hour' | 'day' {
  return endTimestamp - startTimestamp <= 2 * 24 * 3600 ? 'hour' : 'day'
}

function buildParams(
  rangeValue: string,
  customRange: CustomRange
): TokenUsageQueryParams {
  if (rangeValue === CUSTOM_RANGE_VALUE) {
    const startTimestamp = parseDateTimeLocal(customRange.start)
    const endTimestamp = parseDateTimeLocal(customRange.end)

    if (startTimestamp > 0 && endTimestamp > startTimestamp) {
      return {
        start_timestamp: startTimestamp,
        end_timestamp: endTimestamp - 1,
        granularity: customRangeGranularity(startTimestamp, endTimestamp),
        detail_limit: 200,
      }
    }
  }

  const range = RANGE_OPTIONS[Number(rangeValue)] ?? RANGE_OPTIONS[0]
  const end = Math.floor(Date.now() / 1000)
  if (range.mode === 'today') {
    return {
      start_timestamp: dayjs().startOf('day').unix(),
      end_timestamp: end,
      granularity: range.granularity,
      detail_limit: 200,
    }
  }
  return {
    start_timestamp: end - range.days * 24 * 3600,
    end_timestamp: end,
    granularity: range.granularity,
    detail_limit: 200,
  }
}

function StatCard({
  title,
  value,
  detail,
  icon: Icon,
}: {
  title: string
  value: string
  detail?: string
  icon: LucideIcon
}) {
  return (
    <Card size='sm' className='rounded-lg'>
      <CardContent className='flex items-center justify-between gap-3'>
        <div className='min-w-0'>
          <div className='text-muted-foreground text-xs'>{title}</div>
          <div
            className='mt-1 truncate text-xl font-semibold'
            title={detail ?? value}
          >
            {value}
          </div>
          {detail && detail !== value && (
            <div
              className='text-muted-foreground mt-0.5 truncate text-xs'
              title={detail}
            >
              {detail}
            </div>
          )}
        </div>
        <div className='bg-muted flex size-9 shrink-0 items-center justify-center rounded-lg'>
          <Icon className='text-muted-foreground size-4' />
        </div>
      </CardContent>
    </Card>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className='rounded-lg'>
      <CardHeader className='border-b pb-3'>
        <CardTitle className='text-sm'>{title}</CardTitle>
      </CardHeader>
      <CardContent className='pt-1'>{children}</CardContent>
    </Card>
  )
}

function tokenUsageLabel(item: TokenUsageTokenItem) {
  return item.token_name || `#${item.token_id}`
}

function apiKeyColor(index: number) {
  return API_KEY_COLORS[index % API_KEY_COLORS.length]
}

function buildApiKeyColorScale(values: { key: string; color: string }[]) {
  return {
    type: 'ordinal' as const,
    domain: values.map((item) => item.key),
    range: values.map((item) => item.color),
    specified: Object.fromEntries(
      values.map((item) => [item.key, item.color])
    ) as Record<string, string>,
  }
}

function RankMetric({
  label,
  value,
  fullValue,
}: {
  label: string
  value: string
  fullValue?: string
}) {
  return (
    <div
      className='bg-background min-w-0 rounded-md border px-2.5 py-2 shadow-sm'
      title={fullValue ?? value}
    >
      <div className='text-foreground/70 truncate text-[11px] font-medium'>
        {label}
      </div>
      <div className='text-foreground mt-0.5 truncate text-sm font-semibold'>
        {value}
      </div>
    </div>
  )
}

function TokenRankList({
  items,
  colorByKey,
}: {
  items: TokenUsageTokenItem[]
  colorByKey: Map<string, string>
}) {
  const { t } = useTranslation()
  const max = Math.max(...items.map((item) => item.quota), 1)
  const totalQuota = items.reduce((sum, item) => sum + item.quota, 0)

  if (items.length === 0) {
    return (
      <div className='text-muted-foreground py-10 text-center text-sm'>
        {t('No usage data')}
      </div>
    )
  }

  return (
    <div className='space-y-3'>
      {items.slice(0, 10).map((item, index) => {
        const share = totalQuota > 0 ? (item.quota / totalQuota) * 100 : 0
        const keyLabel = tokenUsageLabel(item)
        const color = colorByKey.get(keyLabel) ?? apiKeyColor(index)
        return (
          <div
            key={item.token_id}
            className='bg-background space-y-3 rounded-md border border-l-4 p-3 shadow-sm'
            style={{ borderLeftColor: color }}
          >
            <div className='flex items-start justify-between gap-3'>
              <div className='flex min-w-0 items-center gap-2'>
                <div
                  className='flex size-7 shrink-0 items-center justify-center rounded-md border bg-background text-xs font-bold'
                  style={{ borderColor: color, color }}
                >
                  {index + 1}
                </div>
                <div className='min-w-0'>
                  <div className='text-foreground flex min-w-0 items-center gap-1.5 text-sm font-bold'>
                    <span
                      className='size-2.5 shrink-0 rounded-full'
                      style={{ backgroundColor: color }}
                    />
                    <span className='truncate'>{keyLabel}</span>
                  </div>
                  <div className='text-foreground/70 text-xs font-medium'>
                    {formatPercent(share)} {t('Share')}
                  </div>
                </div>
              </div>
              <div className='shrink-0 text-right'>
                <div className='text-foreground text-sm font-bold'>
                  {formatQuotaWithCurrency(item.quota)}
                </div>
                <div className='text-foreground/70 text-xs font-medium'>
                  {t('Cost')}
                </div>
              </div>
            </div>
            <div className='bg-background h-2 overflow-hidden rounded-full border'>
              <div
                className='h-full rounded-full'
                style={{
                  backgroundColor: color,
                  width: `${Math.max((item.quota / max) * 100, 3)}%`,
                }}
              />
            </div>
            <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>
              <RankMetric
                label={t('Requests')}
                value={formatInteger(item.count)}
              />
              <RankMetric
                label={t('Total Tokens')}
                value={formatCompactTokenCount(item.total_tokens)}
                fullValue={formatInteger(item.total_tokens)}
              />
              <RankMetric
                label={t('Input')}
                value={formatCompactTokenCount(item.prompt_tokens)}
                fullValue={formatInteger(item.prompt_tokens)}
              />
              <RankMetric
                label={t('Output')}
                value={formatCompactTokenCount(item.completion_tokens)}
                fullValue={formatInteger(item.completion_tokens)}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function UsageDetailsTable({ rows }: { rows: TokenUsageDetailItem[] }) {
  const { t } = useTranslation()

  if (rows.length === 0) {
    return (
      <div className='text-muted-foreground py-12 text-center text-sm'>
        {t('No usage data')}
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('Time Range')}</TableHead>
          <TableHead>{t('Token Name')}</TableHead>
          <TableHead>{t('Model')}</TableHead>
          <TableHead className='text-right'>{t('Requests')}</TableHead>
          <TableHead className='text-right'>{t('Input')}</TableHead>
          <TableHead className='text-right'>{t('Output')}</TableHead>
          <TableHead className='text-right'>{t('Cost')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const cache = cacheTokenParts(row)
          return (
            <TableRow
              key={`${row.created_at}-${row.token_id}-${row.model_name}`}
            >
              <TableCell>{formatHourRange(row.created_at)}</TableCell>
              <TableCell>{row.token_name || `#${row.token_id}`}</TableCell>
              <TableCell>{row.model_name || '-'}</TableCell>
              <TableCell className='text-right'>
                {formatInteger(row.count)}
              </TableCell>
              <TableCell className='text-right'>
                <div>{formatInteger(row.prompt_tokens)}</div>
                {(cache.read > 0 || cache.write > 0) && (
                  <div className='text-muted-foreground mt-1 text-[11px] leading-tight'>
                    {cache.read > 0 && (
                      <div>
                        {t('Cache Read')} {formatInteger(cache.read)}
                      </div>
                    )}
                    {cache.write > 0 && (
                      <div>
                        {t('Cache Write')} {formatInteger(cache.write)}
                      </div>
                    )}
                  </div>
                )}
              </TableCell>
              <TableCell className='text-right'>
                {formatInteger(row.completion_tokens)}
              </TableCell>
              <TableCell className='text-right'>
                {formatQuotaWithCurrency(row.quota)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

export function TokenUsage() {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const [rangeValue, setRangeValue] = useState('0')
  const [customRange, setCustomRange] = useState(getDefaultCustomRange)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const isCustomRange = rangeValue === CUSTOM_RANGE_VALUE
  const dateTimeInputStyle = useMemo<CSSProperties>(
    () => ({ colorScheme: resolvedTheme === 'dark' ? 'dark' : 'light' }),
    [resolvedTheme]
  )
  const params = useMemo(
    () => buildParams(rangeValue, customRange),
    [rangeValue, customRange, refreshNonce]
  )

  const handleCustomStartChange = (value: string) => {
    const startTimestamp = parseDateTimeLocal(value)
    const endTimestamp = parseDateTimeLocal(customRange.end)
    setCustomRange({
      start: value,
      end:
        startTimestamp > 0 && endTimestamp <= startTimestamp
          ? dateTimeLocalFromTimestamp(startTimestamp + 3600)
          : customRange.end,
    })
  }

  const handleCustomEndChange = (value: string) => {
    const startTimestamp = parseDateTimeLocal(customRange.start)
    const endTimestamp = parseDateTimeLocal(value)
    setCustomRange({
      start:
        endTimestamp > 0 && startTimestamp >= endTimestamp
          ? dateTimeLocalFromTimestamp(endTimestamp - 3600)
          : customRange.start,
      end: value,
    })
  }

  const query = useQuery({
    queryKey: ['token-usage-self', params],
    queryFn: () => getTokenUsageSelf(params),
  })

  const data = query.data?.data ?? emptyTokenUsage()
  const loading = query.isLoading || query.isFetching

  const apiKeyValues = useMemo(
    () =>
      data.by_token.map((item: TokenUsageTokenItem, index) => ({
        key: tokenUsageLabel(item),
        tokens: item.total_tokens,
        requests: item.count,
        cost: item.quota,
        color: apiKeyColor(index),
      })),
    [data.by_token]
  )

  const apiKeyShareValues = useMemo(
    () =>
      data.by_token.map((item: TokenUsageTokenItem, index) => ({
        key: tokenUsageLabel(item),
        tokens: item.total_tokens,
        requests: item.count,
        color: apiKeyColor(index),
      })),
    [data.by_token]
  )

  const apiKeyColorScale = useMemo(
    () => buildApiKeyColorScale(apiKeyValues),
    [apiKeyValues]
  )

  const apiKeyColorByKey = useMemo(
    () =>
      new Map(apiKeyValues.map((item) => [item.key, item.color] as const)),
    [apiKeyValues]
  )

  const apiKeyBarSpec = useMemo(
    () => ({
      type: 'bar',
      data: [{ id: 'apiKeyUsage', values: loading ? [] : apiKeyValues }],
      color: apiKeyColorScale,
      xField: 'key',
      yField: 'tokens',
      seriesField: 'key',
      axes: [
        {
          orient: 'bottom',
          label: { autoRotate: true, autoHide: true, autoLimit: true },
        },
        {
          orient: 'left',
          title: { visible: true, text: t('Tokens') },
          label: { formatMethod: formatCompactTokenCount },
        },
      ],
      label: {
        visible: apiKeyValues.length > 0 && apiKeyValues.length <= 12,
        position: 'outside',
        formatMethod: formatChartTokenLabel,
        style: { fontSize: 11 },
      },
      legends: { visible: apiKeyValues.length <= 12, orient: 'bottom' },
      tooltip: {
        mark: {
          content: [
            {
              key: t('Tokens'),
              value: (datum: Record<string, unknown>) =>
                formatCompactWithFullValue(datum?.tokens),
            },
            {
              key: t('Requests'),
              value: (datum: Record<string, unknown>) =>
                formatCompactWithFullValue(datum?.requests),
            },
            {
              key: t('Cost'),
              value: (datum: Record<string, unknown>) =>
                formatQuotaWithCurrency(toFiniteNumber(datum?.cost)),
            },
          ],
        },
      },
      title: loading
        ? undefined
        : apiKeyValues.length === 0
          ? { visible: true, text: t('No usage data') }
          : undefined,
      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
      background: 'transparent',
    }),
    [apiKeyColorScale, apiKeyValues, loading, resolvedTheme, t]
  )

  const apiKeyShareSpec = useMemo(
    () => ({
      type: 'pie',
      data: [{ id: 'apiKeyShare', values: loading ? [] : apiKeyShareValues }],
      color: apiKeyColorScale,
      categoryField: 'key',
      valueField: 'tokens',
      outerRadius: 0.82,
      innerRadius: 0.52,
      padAngle: 0.8,
      legends: { visible: true, orient: 'bottom' },
      label: {
        visible: apiKeyShareValues.length > 0 && apiKeyShareValues.length <= 8,
        formatMethod: formatChartTokenLabel,
        style: { fontSize: 11 },
      },
      tooltip: {
        mark: {
          content: [
            {
              key: t('Tokens'),
              value: (datum: Record<string, unknown>) =>
                formatCompactWithFullValue(datum?.tokens),
            },
            {
              key: t('Requests'),
              value: (datum: Record<string, unknown>) =>
                formatCompactWithFullValue(datum?.requests),
            },
          ],
        },
      },
      title: loading
        ? undefined
        : apiKeyShareValues.length === 0
          ? { visible: true, text: t('No usage data') }
          : undefined,
      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
      background: 'transparent',
    }),
    [apiKeyColorScale, apiKeyShareValues, loading, resolvedTheme, t]
  )

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Token Usage')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <NativeSelect
          value={rangeValue}
          onChange={(event) => setRangeValue(event.target.value)}
          aria-label={t('Time Range')}
        >
          {RANGE_OPTIONS.map((option, index) => (
            <option key={option.labelKey} value={index}>
              {t(option.labelKey)}
            </option>
          ))}
          <option value={CUSTOM_RANGE_VALUE}>{t('Custom')}</option>
        </NativeSelect>
        {isCustomRange && (
          <div className='flex flex-wrap items-center gap-2'>
            <label className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
              <span>{t('Start Time')}</span>
              <Input
                type='datetime-local'
                step={3600}
                value={customRange.start}
                onChange={(event) =>
                  handleCustomStartChange(event.target.value)
                }
                className='bg-background text-foreground w-[180px]'
                style={dateTimeInputStyle}
              />
            </label>
            <label className='text-muted-foreground flex items-center gap-1.5 text-xs font-medium'>
              <span>{t('End Time')}</span>
              <Input
                type='datetime-local'
                step={3600}
                value={customRange.end}
                onChange={(event) => handleCustomEndChange(event.target.value)}
                className='bg-background text-foreground w-[180px]'
                style={dateTimeInputStyle}
              />
            </label>
          </div>
        )}
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => setRefreshNonce((value) => value + 1)}
          disabled={loading}
        >
          <RefreshCw className='size-4' />
          {t('Refresh')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-4'>
          <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
            <StatCard
              title={t('Total Requests')}
              value={formatCompactTokenCount(data.summary.total_requests)}
              detail={formatInteger(data.summary.total_requests)}
              icon={BarChart3}
            />
            <StatCard
              title={t('Total Tokens')}
              value={formatCompactTokenCount(data.summary.total_tokens)}
              detail={`${formatInteger(data.summary.total_tokens)} ${t('Tokens')}`}
              icon={Sparkles}
            />
            <StatCard
              title={t('Total Cost')}
              value={formatQuotaWithCurrency(data.summary.total_quota)}
              icon={Clock}
            />
            <StatCard
              title={t('API Keys Used')}
              value={formatInteger(data.summary.api_key_count)}
              icon={Key}
            />
          </div>

          <div className='grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]'>
            <Panel title={t('Token Usage')}>
              <div className='h-[320px]'>
                <VChart spec={apiKeyBarSpec} option={VCHART_OPTION} />
              </div>
            </Panel>
            <Panel title={t('Token Share')}>
              <div className='h-[320px]'>
                <VChart spec={apiKeyShareSpec} option={VCHART_OPTION} />
              </div>
            </Panel>
          </div>

          <div className='grid gap-4 xl:grid-cols-[minmax(320px,0.45fr)_minmax(0,1fr)]'>
            <Panel title={t('Token Ranking')}>
              <TokenRankList
                items={data.by_token as TokenUsageTokenItem[]}
                colorByKey={apiKeyColorByKey}
              />
            </Panel>
            <Panel title={t('Usage Details')}>
              <UsageDetailsTable rows={data.rows} />
            </Panel>
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
